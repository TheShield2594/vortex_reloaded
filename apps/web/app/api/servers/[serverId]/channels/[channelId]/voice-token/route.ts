import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { AccessToken } from "livekit-server-sdk"

type Params = { params: Promise<{ serverId: string; channelId: string }> }

/**
 * POST /api/servers/[serverId]/channels/[channelId]/voice-token
 *
 * Generates a Livekit access token for a user joining a voice/stage channel.
 * The room name is derived from the channel ID to ensure isolation.
 * Requires CONNECT_VOICE permission.
 *
 * Environment variables required:
 *   LIVEKIT_API_KEY     — Livekit API key
 *   LIVEKIT_API_SECRET  — Livekit API secret
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { serverId, channelId } = await params
    const { supabase, user, error } = await requireServerPermission(serverId, "CONNECT_VOICE")
    if (error) return error

    const livekitApiKey = process.env.LIVEKIT_API_KEY
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL

    if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
      return NextResponse.json(
        { error: "Livekit is not configured. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and NEXT_PUBLIC_LIVEKIT_URL." },
        { status: 503 }
      )
    }

    // Verify channel belongs to this server and is a real-time audio channel
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, name, type, server_id")
      .eq("id", channelId)
      .eq("server_id", serverId)
      .single()

    if (channelError) {
      console.error("[voice-token GET] DB error:", channelError.message)
      return NextResponse.json({ error: "Failed to retrieve channel" }, { status: 500 })
    }

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    if (channel.type !== "voice" && channel.type !== "stage") {
      return NextResponse.json({ error: "Channel is not a voice/stage channel" }, { status: 400 })
    }

    // Fetch user profile for display name
    const { data: profile } = await supabase
      .from("users")
      .select("username, display_name, avatar_url")
      .eq("id", user!.id)
      .single()

    const displayName = profile?.display_name || profile?.username || user!.email || "Unknown"

    // Room name is scoped to server + channel for isolation
    const roomName = `${serverId}:${channelId}`

    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: user!.id,
      name: displayName,
      ttl: "4h",
    })

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    })

    const token = await at.toJwt()

    return NextResponse.json({
      token,
      url: livekitUrl,
      room: roomName,
      identity: user!.id,
      displayName,
    })

  } catch (err) {
    console.error("[servers/[serverId]/channels/[channelId]/voice-token POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
