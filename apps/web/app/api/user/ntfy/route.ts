import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, ntfySubscriptions } from "@vortex/db"
import { requireAuth, parseJsonBody, apiError } from "@/lib/utils/api-helpers"
import { generateNtfyTopic, isNtfyConfigured } from "@/lib/ntfy"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/user/ntfy")
const db = createDb()

const TOPIC_GENERATION_RETRIES = 5

// GET /api/user/ntfy — read the current user's self-hosted ntfy subscription state
export async function GET() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const rows = await db
      .select({ topic: ntfySubscriptions.topic, enabled: ntfySubscriptions.enabled })
      .from(ntfySubscriptions)
      .where(eq(ntfySubscriptions.userId, user.id))
      .limit(1)
    const row = rows[0]

    return NextResponse.json({
      serverConfigured: isNtfyConfigured(),
      publicUrl: process.env.NEXT_PUBLIC_NTFY_URL || null,
      topic: row?.topic ?? null,
      enabled: row?.enabled ?? false,
    })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "GET", error: err instanceof Error ? err.message : String(err) }, "GET error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/user/ntfy — create (if missing) the user's private topic and enable delivery
export async function POST() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    if (!isNtfyConfigured()) {
      return apiError("Self-hosted ntfy push is not configured on this server", 400)
    }

    const existing = await db
      .select({ topic: ntfySubscriptions.topic })
      .from(ntfySubscriptions)
      .where(eq(ntfySubscriptions.userId, user.id))
      .limit(1)

    if (existing[0]) {
      await db
        .update(ntfySubscriptions)
        .set({ enabled: true })
        .where(eq(ntfySubscriptions.userId, user.id))
      return NextResponse.json({ topic: existing[0].topic, enabled: true })
    }

    let topic: string | null = null
    for (let attempt = 0; attempt < TOPIC_GENERATION_RETRIES && !topic; attempt++) {
      try {
        const candidate = generateNtfyTopic()
        await db.insert(ntfySubscriptions).values({ userId: user.id, topic: candidate, enabled: true })
        topic = candidate
      } catch (err) {
        // Unique constraint collision on `topic` — astronomically unlikely
        // (32 base36 chars) but retry rather than fail outright.
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined
        if (code !== "SQLITE_CONSTRAINT_UNIQUE" || attempt === TOPIC_GENERATION_RETRIES - 1) {
          log.error({ route: "/api/user/ntfy", action: "POST", userId: user.id, error: err instanceof Error ? err.message : String(err) }, "failed to create ntfy subscription")
          return NextResponse.json({ error: "Failed to enable ntfy push" }, { status: 500 })
        }
      }
    }

    if (!topic) return NextResponse.json({ error: "Failed to enable ntfy push" }, { status: 500 })

    return NextResponse.json({ topic, enabled: true }, { status: 201 })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "POST", error: err instanceof Error ? err.message : String(err) }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/user/ntfy — toggle delivery on/off without changing the topic
export async function PUT(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data: body, error: parseError } = await parseJsonBody<{ enabled?: unknown }>(req)
    if (parseError) return parseError

    if (typeof body.enabled !== "boolean") {
      return apiError("enabled must be a boolean", 400)
    }

    const updated = await db
      .update(ntfySubscriptions)
      .set({ enabled: body.enabled })
      .where(eq(ntfySubscriptions.userId, user.id))
      .returning({ topic: ntfySubscriptions.topic })

    if (!updated.length) {
      return apiError("No ntfy topic to update — POST first to create one", 404)
    }

    return NextResponse.json({ topic: updated[0]?.topic, enabled: body.enabled })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "PUT", error: err instanceof Error ? err.message : String(err) }, "PUT error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/user/ntfy — rotate the topic (e.g. if it was ever shared/leaked)
export async function DELETE() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const existing = await db
      .select({ enabled: ntfySubscriptions.enabled })
      .from(ntfySubscriptions)
      .where(eq(ntfySubscriptions.userId, user.id))
      .limit(1)

    if (!existing[0]) {
      return apiError("No ntfy subscription to rotate", 404)
    }

    let topic: string | null = null
    for (let attempt = 0; attempt < TOPIC_GENERATION_RETRIES && !topic; attempt++) {
      try {
        const candidate = generateNtfyTopic()
        await db
          .update(ntfySubscriptions)
          .set({ topic: candidate })
          .where(eq(ntfySubscriptions.userId, user.id))
        topic = candidate
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined
        if (code !== "SQLITE_CONSTRAINT_UNIQUE" || attempt === TOPIC_GENERATION_RETRIES - 1) {
          log.error({ route: "/api/user/ntfy", action: "DELETE", userId: user.id, error: err instanceof Error ? err.message : String(err) }, "failed to rotate ntfy topic")
          return NextResponse.json({ error: "Failed to rotate ntfy topic" }, { status: 500 })
        }
      }
    }

    if (!topic) return NextResponse.json({ error: "Failed to rotate ntfy topic" }, { status: 500 })

    return NextResponse.json({ topic, enabled: existing[0].enabled })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "DELETE", error: err instanceof Error ? err.message : String(err) }, "DELETE error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
