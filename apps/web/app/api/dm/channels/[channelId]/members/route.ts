import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { publishGatewayEvent } from "@/lib/gateway-publish"

// POST /api/dm/channels/[channelId]/members — add a member to a group DM
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify caller membership and channel type in parallel
    const [{ data: membership }, { data: channel }] = await Promise.all([
      supabase
        .from("dm_channel_members")
        .select("user_id")
        .eq("dm_channel_id", channelId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("dm_channels")
        .select("is_group")
        .eq("id", channelId)
        .single(),
    ])

    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    if (!channel?.is_group) {
      return NextResponse.json({ error: "Cannot add members to a 1:1 DM" }, { status: 400 })
    }

    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    const { error } = await supabase
      .from("dm_channel_members")
      .insert({ dm_channel_id: channelId, user_id: userId, added_by: user.id })

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Already a member" }, { status: 409 })
      return NextResponse.json({ error: "Failed to add member" }, { status: 500 })
    }

    // Existing members (already subscribed to this channel) see the join;
    // the new member isn't in the channel's gateway room yet, so notify them
    // directly via their per-user channel so their DM list picks it up.
    publishGatewayEvent({
      type: "member.joined",
      channelId,
      actorId: user.id,
      data: { channelId, userId },
    }, { route: "/api/dm/channels/[channelId]/members" })
    publishGatewayEvent({
      type: "member.joined",
      channelId: `user:${userId}`,
      actorId: user.id,
      data: { channelId },
    }, { route: "/api/dm/channels/[channelId]/members" })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/channels/[channelId]/members POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/dm/channels/[channelId]/members?userId=... — remove a member (or leave)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const targetUserId = searchParams.get("userId") ?? user.id

    // Only owners can remove others; anyone can remove themselves
    if (targetUserId !== user.id) {
      const { data: channel } = await supabase
        .from("dm_channels")
        .select("owner_id")
        .eq("id", channelId)
        .single()

      if (channel?.owner_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { error } = await supabase
      .from("dm_channel_members")
      .delete()
      .eq("dm_channel_id", channelId)
      .eq("user_id", targetUserId)

    if (error) return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })

    // Remaining members (subscribed to this channel) see the departure; the
    // removed member is notified via their per-user channel so their DM
    // list drops the channel.
    publishGatewayEvent({
      type: "member.left",
      channelId,
      actorId: user.id,
      data: { channelId, userId: targetUserId },
    }, { route: "/api/dm/channels/[channelId]/members" })
    publishGatewayEvent({
      type: "member.left",
      channelId: `user:${targetUserId}`,
      actorId: user.id,
      data: { channelId },
    }, { route: "/api/dm/channels/[channelId]/members" })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[dm/channels/[channelId]/members DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
