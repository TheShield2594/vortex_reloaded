import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"

/**
 * GET /api/users/me/read-states
 *
 * Returns all read states for the authenticated user across all channels and DMs.
 * Used for bulk hydration of unread indicators on app load or reconnect.
 *
 * Response: {
 *   channels: Array<{ channel_id: string; last_read_at: string; mention_count: number }>,
 *   dms: Array<{ dm_channel_id: string; last_read_at: string }>,
 *   threads: Array<{ thread_id: string; last_read_at: string; mention_count: number }>
 * }
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Fetch all three read state tables in parallel
    const [channelResult, dmResult, threadResult] = await Promise.all([
      supabase
        .from("read_states")
        .select("channel_id, last_read_at, mention_count")
        .eq("user_id", user.id),
      supabase
        .from("dm_read_states")
        .select("dm_channel_id, last_read_at")
        .eq("user_id", user.id),
      supabase
        .from("thread_read_states")
        .select("thread_id, last_read_at, mention_count")
        .eq("user_id", user.id),
    ])

    if (channelResult.error || dmResult.error || threadResult.error) {
      console.error("[read-states] Failed to fetch read states:", {
        userId: user.id,
        channelError: channelResult.error?.message,
        dmError: dmResult.error?.message,
        threadError: threadResult.error?.message,
      })
      return NextResponse.json({ error: "Failed to fetch read states" }, { status: 500 })
    }

    return NextResponse.json({
      channels: channelResult.data ?? [],
      dms: dmResult.data ?? [],
      threads: threadResult.data ?? [],
    })
  } catch (err) {
    console.error("[read-states] Unexpected error:", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
