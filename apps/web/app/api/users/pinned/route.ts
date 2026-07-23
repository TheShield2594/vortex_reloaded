import { NextResponse } from "next/server"
import { and, asc, count, eq } from "drizzle-orm"
import { createDb, userPinnedItems } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"
import type { UserPinnedItemRow } from "@/types/database"

const db = createDb()

const MAX_PINS = 6
const VALID_PIN_TYPES = ["message", "channel", "file", "link"] as const
type PinType = typeof VALID_PIN_TYPES[number]

function isPinType(v: unknown): v is PinType {
  return VALID_PIN_TYPES.includes(v as PinType)
}

/** GET /api/users/pinned?userId={id} — fetch pinned items (authenticated) */
export async function GET(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId") ?? user.id

    let rows
    try {
      rows = await db
        .select()
        .from(userPinnedItems)
        .where(eq(userPinnedItems.userId, userId))
        .orderBy(asc(userPinnedItems.position))
    } catch {
      return NextResponse.json({ error: "Failed to fetch pinned items" }, { status: 500 })
    }

    return NextResponse.json({ pins: toSnakeCase<UserPinnedItemRow[]>(rows) })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/users/pinned — add a new pinned item (owner only) */
export async function POST(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Enforce max pins
    const [{ value: pinCount }] = await db
      .select({ value: count() })
      .from(userPinnedItems)
      .where(eq(userPinnedItems.userId, user.id))
    if ((pinCount ?? 0) >= MAX_PINS) {
      return NextResponse.json({ error: `You can pin at most ${MAX_PINS} items` }, { status: 422 })
    }

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const { pin_type, label, sublabel, ref_id, url, position } = body

    if (!isPinType(pin_type)) {
      return NextResponse.json({ error: `pin_type must be one of: ${VALID_PIN_TYPES.join(", ")}` }, { status: 422 })
    }
    if (typeof label !== "string" || label.trim().length === 0 || label.length > 120) {
      return NextResponse.json({ error: "label must be a non-empty string (max 120 chars)" }, { status: 422 })
    }
    if (sublabel !== undefined && sublabel !== null && (typeof sublabel !== "string" || sublabel.length > 80)) {
      return NextResponse.json({ error: "sublabel must be a string (max 80 chars)" }, { status: 422 })
    }
    if (url !== undefined && url !== null && (typeof url !== "string" || url.length > 2000)) {
      return NextResponse.json({ error: "url must be a string (max 2000 chars)" }, { status: 422 })
    }

    let row: typeof userPinnedItems.$inferSelect | undefined
    try {
      const rows = await db
        .insert(userPinnedItems)
        .values({
          userId: user.id,
          pinType: pin_type,
          label: label.trim(),
          sublabel: sublabel?.trim() ?? null,
          refId: ref_id ?? null,
          url: url ?? null,
          position: typeof position === "number" ? position : 0,
        })
        .returning()
      row = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to add pin" }, { status: 500 })
    }

    if (!row) return NextResponse.json({ error: "Failed to add pin" }, { status: 500 })
    return NextResponse.json({ pin: toSnakeCase<UserPinnedItemRow>(row) }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE /api/users/pinned?id={pinId} — remove a pinned item (owner only) */
export async function DELETE(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const pinId = searchParams.get("id")
    if (!pinId) return NextResponse.json({ error: "id query parameter is required" }, { status: 400 })

    try {
      await db
        .delete(userPinnedItems)
        .where(and(eq(userPinnedItems.id, pinId), eq(userPinnedItems.userId, user.id))) // ownership check
    } catch {
      return NextResponse.json({ error: "Failed to delete pin" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** PATCH /api/users/pinned?id={pinId} — update label / sublabel / url / position */
export async function PATCH(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const pinId = searchParams.get("id")
    if (!pinId) return NextResponse.json({ error: "id query parameter is required" }, { status: 400 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const patch: Partial<typeof userPinnedItems.$inferInsert> = {}
    if ("label" in body) {
      if (typeof body.label !== "string" || body.label.trim().length === 0 || body.label.length > 120) {
        return NextResponse.json({ error: "label must be a non-empty string (max 120 chars)" }, { status: 422 })
      }
      patch.label = body.label.trim()
    }
    if ("sublabel" in body) {
      patch.sublabel = body.sublabel?.trim() ?? null
    }
    if ("url" in body) {
      patch.url = body.url ?? null
    }
    if ("position" in body && typeof body.position === "number") {
      patch.position = body.position
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 })
    }

    let row: typeof userPinnedItems.$inferSelect | undefined
    try {
      const rows = await db
        .update(userPinnedItems)
        .set(patch)
        .where(and(eq(userPinnedItems.id, pinId), eq(userPinnedItems.userId, user.id)))
        .returning()
      row = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to update pin" }, { status: 500 })
    }

    if (!row) return NextResponse.json({ error: "Failed to update pin" }, { status: 500 })
    return NextResponse.json({ pin: toSnakeCase<UserPinnedItemRow>(row) })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
