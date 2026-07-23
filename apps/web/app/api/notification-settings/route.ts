import { NextRequest, NextResponse } from "next/server"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

/**
 * Per-server/channel/thread notification overrides. The `notification_settings`
 * table (and the `servers`/`channels`/`threads` tables it referenced) was
 * retired entirely during the SQLite migration (issue #36) — server/channel
 * messaging no longer exists anywhere in this stack, so there is no longer
 * any storage backing this route. It's kept alive (rather than deleted, which
 * is out of scope here) but every operation is now a truthful no-op: no
 * override can exist, so reads report defaults/empty and writes report
 * nothing changed, without touching any Supabase client.
 */

// GET /api/notification-settings?serverId=...&channelId=...
export async function GET(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const serverId = searchParams.get("serverId")
    const channelId = searchParams.get("channelId")
    const threadId = searchParams.get("threadId")

    if (threadId) {
      // Threads no longer exist — every threadId resolves to "not found".
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

    if (!serverId && !channelId) {
      // Return all settings for this user — always empty, nothing can persist one.
      return NextResponse.json([])
    }

    return NextResponse.json({ mode: "all" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/notification-settings — upsert a setting
export async function PUT(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const payload = await req.json() as Record<string, unknown>
    const { serverId, channelId, threadId, mode } = payload

    if ((serverId !== undefined && typeof serverId !== "string")
      || (channelId !== undefined && typeof channelId !== "string")
      || (threadId !== undefined && typeof threadId !== "string")) {
      return NextResponse.json({ error: "serverId, channelId, and threadId must be strings" }, { status: 400 })
    }

    if (!["all", "mentions", "muted"].includes(String(mode))) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }
    if (!serverId && !channelId && !threadId) {
      return NextResponse.json({ error: "serverId, channelId, or threadId required" }, { status: 400 })
    }

    // No storage backs this anymore (see module comment) — nothing to persist.
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/notification-settings — reset to default
export async function DELETE(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const serverId = searchParams.get("serverId")
    const channelId = searchParams.get("channelId")
    const threadId = searchParams.get("threadId")

    if (!threadId && !serverId && !channelId) {
      return NextResponse.json({ error: "serverId, channelId, or threadId required" }, { status: 400 })
    }

    // No storage backs this anymore (see module comment) — nothing was ever there to delete.
    return NextResponse.json({ ok: true, deleted: false }, { status: 404 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
