import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb, pushSubscriptions } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

const db = createDb()

// POST /api/push — save a push subscription
export async function POST(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const { endpoint, keys } = body
    if (!endpoint || typeof endpoint !== "string" || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 })
    }

    try {
      await db
        .insert(pushSubscriptions)
        .values({
          userId: user.id,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent: req.headers.get("user-agent"),
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
          set: {
            p256dh: keys.p256dh,
            auth: keys.auth,
            userAgent: req.headers.get("user-agent"),
          },
        })
    } catch {
      return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/push — remove a push subscription
export async function DELETE(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { endpoint } = await req.json()
    if (!endpoint || typeof endpoint !== "string") {
      return NextResponse.json({ error: "endpoint required" }, { status: 400 })
    }

    try {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)))
    } catch {
      return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
