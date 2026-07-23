import { NextResponse } from "next/server"
import { AccessToken, RoomServiceClient } from "livekit-server-sdk"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { createLogger } from "@/lib/logger"

const log = createLogger("dm-call-token")

// LiveKit tokens are the entire authorization mechanism (LiveKit has no
// separate room-membership concept of its own) — keep the TTL short enough
// that a leaked token can't be replayed long after a call ends.
const TOKEN_TTL_SECONDS = 4 * 60 * 60 // 4 hours

// POST /api/dm/channels/[channelId]/call/token — mint a room-scoped LiveKit AccessToken
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  const { channelId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await getBetterAuthUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Verify membership — same dm_channel_members lookup used by every other
  // privileged DM route (see call/route.ts). The membership check has to
  // happen before minting, since the signed JWT grant below is the only
  // authorization LiveKit itself will ever check.
  const { data: members } = await supabase
    .from("dm_channel_members")
    .select("user_id")
    .eq("dm_channel_id", channelId)

  const isMember = members?.some((m: { user_id: string }) => m.user_id === user.id)
  if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json({ error: "LiveKit not configured" }, { status: 503 })
  }

  const roomName = `dm-${channelId}`

  // Defense-in-depth: explicitly cap the room at this DM's fixed membership
  // size. Not required — LiveKit auto-creates rooms on first join with no
  // participant cap — but bounds exposure even if a token leaked. Failure
  // here is non-fatal; auto-create-on-join covers us either way.
  const apiUrl = process.env.LIVEKIT_API_URL
  if (apiUrl && members?.length) {
    try {
      const roomService = new RoomServiceClient(apiUrl, apiKey, apiSecret)
      await roomService.createRoom({ name: roomName, maxParticipants: members.length })
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), roomName },
        "defense-in-depth createRoom call failed; continuing"
      )
    }
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    ttl: TOKEN_TTL_SECONDS,
  })
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })

  const token = await at.toJwt()

  return NextResponse.json({ token, url: livekitUrl, roomName })
}
