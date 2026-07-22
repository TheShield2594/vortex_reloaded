import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"

/**
 * POST /api/channels/[channelId]/ack
 *
 * Acknowledge (mark as read) a channel. Uses the existing mark_channel_read
 * RPC which atomically updates last_read_at and resets mention_count.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Validate channelId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(channelId)) {
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 })
    }

    // Permission check: verify user has access to this channel via membership
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, server_id")
      .eq("id", channelId)
      .maybeSingle()

    if (channelError) {
      console.error("[ack] Failed to verify channel access:", {
        userId: user.id,
        channelId,
        error: channelError.message,
      })
      return NextResponse.json({ error: "Failed to verify channel access" }, { status: 500 })
    }
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Verify server membership
    const { data: member, error: memberError } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", channel.server_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberError) {
      console.error("[ack] Failed to verify membership:", {
        userId: user.id,
        channelId,
        serverId: channel.server_id,
        error: memberError.message,
      })
      return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
    }

    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Use the existing atomic RPC that updates last_read_at and resets mention_count
    const { error: rpcError } = await supabase.rpc("mark_channel_read", {
      p_channel_id: channelId,
    })

    if (rpcError) {
      console.error("[ack] mark_channel_read RPC failed:", {
        userId: user.id,
        channelId,
        error: rpcError.message,
      })
      return NextResponse.json({ error: "Failed to update read state" }, { status: 500 })
    }

    return NextResponse.json({ acknowledged: true })
  } catch (err) {
    console.error("[ack] Unexpected error:", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
