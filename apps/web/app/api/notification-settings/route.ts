import { NextRequest, NextResponse } from "next/server"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

/**
 * Per-channel/thread notification overrides. The `notification_settings`
 * table (and the `channels`/`threads` tables it referenced) was retired
 * entirely during the SQLite migration (issue #36), so there is no longer any
 * storage backing this route. Only the read path is still consumed (the app
 * store loads all overrides on boot); it's a truthful no-op — no override can
 * exist, so it always reports an empty set.
 */

// GET /api/notification-settings — list this user's overrides (always empty)
export async function GET(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const channelId = searchParams.get("channelId")
    const threadId = searchParams.get("threadId")

    if (threadId) {
      // Threads no longer exist — every threadId resolves to "not found".
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }

    if (!channelId) {
      // Return all settings for this user — always empty, nothing can persist one.
      return NextResponse.json([])
    }

    return NextResponse.json({ mode: "all" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
