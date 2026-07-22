import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { sendPushToUser } from "@/lib/push"

// POST /api/dm/channels/[channelId]/call — broadcast a WebRTC signaling event
// Body: { type: "offer"|"answer"|"ice-candidate"|"hangup", payload: any, targetUserId?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  const { channelId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Verify membership
  const { data: membership } = await supabase
    .from("dm_channel_members")
    .select("user_id")
    .eq("dm_channel_id", channelId)
    .eq("user_id", user.id)
    .single()

  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const body = await req.json()
    const { type, payload, targetUserId } = body

    // Use Supabase Realtime Broadcast for WebRTC signaling
    const channel = supabase.channel(`dm-call:${channelId}`)
    await channel.send({
      type: "broadcast",
      event: "call-signal",
      payload: {
        type,
        payload,
        fromUserId: user.id,
        targetUserId,
        channelId: channelId,
      },
    })

    // Send push notification for incoming call (offer = call initiation)
    if (type === "offer") {
      const { data: caller } = await supabase
        .from("users")
        .select("display_name, username")
        .eq("id", user.id)
        .maybeSingle()

      const callerName = caller?.display_name || caller?.username || "Someone"

      // Notify all other members in the DM channel
      const { data: otherMembers } = await supabase
        .from("dm_channel_members")
        .select("user_id")
        .eq("dm_channel_id", channelId)
        .neq("user_id", user.id)

      if (otherMembers?.length) {
        await Promise.allSettled(
          otherMembers.map((m: { user_id: string }) =>
            sendPushToUser(m.user_id, {
              title: `${callerName} is calling...`,
              body: "Tap to answer",
              url: `/channels/me/${channelId}`,
              tag: `dm-call-${channelId}`,
            })
          )
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to send signal" }, { status: 500 })
  }
}
