import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { sendPushToChannel } from "@/lib/push"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/dm/messages")

function isValidDmE2eeEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const envelope = value as Record<string, unknown>
  return envelope.kind === "dm-e2ee"
    && envelope.version === 1
    && envelope.algorithm === "AES-GCM"
    && typeof envelope.iv === "string"
    && envelope.iv.length > 0
    && typeof envelope.ciphertext === "string"
    && envelope.ciphertext.length > 0
    && typeof envelope.keyVersion === "number"
    && Number.isInteger(envelope.keyVersion)
    && envelope.keyVersion >= 0
}


// POST /api/dm/channels/[channelId]/messages — send a message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
  const { channelId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const limited = await checkRateLimit(user.id, "dm:send", { limit: 15, windowMs: 10_000 })
  if (limited) return limited

  // Fetch all channel members (verifies membership and gets other member IDs in one query)
  const { data: channelMembers, error: channelMembersError } = await supabase
    .from("dm_channel_members")
    .select("user_id")
    .eq("dm_channel_id", channelId)

  if (channelMembersError || !channelMembers) {
    return NextResponse.json({ error: "Failed to load DM members" }, { status: 500 })
  }

  if (!channelMembers.some((member) => member.user_id === user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const otherMemberIds = channelMembers
    .filter((member) => member.user_id !== user.id)
    .map((member) => member.user_id)

  // Run blocking checks, body parsing, and channel encryption fetch in parallel
  const [blockCheckResult, bodyResult, channelResult] = await Promise.all([
    Promise.all(
      otherMemberIds.map((memberId) => isBlockedBetweenUsers(supabase, user.id, memberId))
    ).then((results) => ({ blocked: results.some(Boolean), error: null as Error | null }))
     .catch((error: Error) => ({ blocked: false, error })),
    req.json().then((b: unknown) => ({ body: b as { content?: string; reply_to_id?: string }, error: null as string | null }))
      .catch(() => ({ body: null as { content?: string; reply_to_id?: string } | null, error: "Invalid JSON body" })),
    supabase
      .from("dm_channels")
      .select("is_encrypted, encryption_key_version")
      .eq("id", channelId)
      .maybeSingle(),
  ])

  if (blockCheckResult.error) {
    log.error({ route: "/api/dm/channels/[channelId]/messages", action: "blockCheck", userId: user.id, channelId, error: blockCheckResult.error.message }, "block check failed")
    return NextResponse.json(
      { error: "Error checking block status" },
      { status: 500 }
    )
  }
  if (blockCheckResult.blocked) {
    return NextResponse.json({ error: "Cannot send messages while blocked" }, { status: 403 })
  }

  if (bodyResult.error || !bodyResult.body) {
    return NextResponse.json({ error: bodyResult.error ?? "Invalid JSON body" }, { status: 400 })
  }
  const body = bodyResult.body

  const { data: channel, error: channelError } = channelResult
  if (channelError || !channel) {
    return NextResponse.json({ error: "Unable to verify channel encryption" }, { status: 500 })
  }
  const channelInfo = channel
  if (typeof body.content !== "string") return NextResponse.json({ error: "Content required" }, { status: 400 })
  const content = body.content.trim()
  if (!content) return NextResponse.json({ error: "Content required" }, { status: 400 })

  if (channelInfo?.is_encrypted) {
    try {
      const parsed = JSON.parse(content)
      if (!isValidDmE2eeEnvelope(parsed)) {
        return NextResponse.json({ error: "Encrypted channels require encrypted payload" }, { status: 400 })
      }
      if (parsed.keyVersion !== channelInfo.encryption_key_version) {
        return NextResponse.json({ error: "Encrypted channels require current keyVersion" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: "Encrypted channels require encrypted payload" }, { status: 400 })
    }
  }

  // Validate reply_to_id and fetch full reply data in one query (avoids redundant re-fetch after insert)
  const replyToId = body.reply_to_id ?? null
  let replyToMessage: Record<string, unknown> | null = null
  if (replyToId) {
    const { data: replyTarget, error: replyError } = await supabase
      .from("direct_messages")
      .select("id, dm_channel_id, content, sender_id, sender:users!direct_messages_sender_id_fkey(id, username, display_name, avatar_url, status)")
      .eq("id", replyToId)
      .is("deleted_at", null)
      .single()

    if (replyError || !replyTarget) {
      return NextResponse.json({ error: "Replied-to message not found" }, { status: 400 })
    }
    if (replyTarget.dm_channel_id !== channelId) {
      return NextResponse.json({ error: "Replied-to message must be in the same channel" }, { status: 400 })
    }
    replyToMessage = replyTarget as unknown as Record<string, unknown>
  }

  const { data: message, error } = await supabase
    .from("direct_messages")
    .insert({
      dm_channel_id: channelId,
      sender_id: user.id,
      content,
      ...(replyToId ? { reply_to_id: replyToId } : {}),
    })
    .select("*, sender:users!direct_messages_sender_id_fkey(id, username, display_name, avatar_url, status)")
    .single()

  if (error) return NextResponse.json({ error: "Failed to send message" }, { status: 500 })

  // Send push notifications (fire-and-forget)
  const sender = (message as unknown as { sender?: { display_name?: string; username?: string; avatar_url?: string | null } }).sender
  const senderName = sender?.display_name || sender?.username || "Someone"
  sendPushToChannel({
    dmChannelId: channelId,
    senderName,
    senderAvatarUrl: sender?.avatar_url ?? null,
    content: channelInfo?.is_encrypted ? "Encrypted message" : content,
    excludeUserId: user.id,
  }).catch(() => {})

  return NextResponse.json({ ...message, reply_to_id: replyToId, reply_to: replyToMessage }, { status: 201 })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"
    log.error({ route: "/api/dm/channels/[channelId]/messages", action: "POST", error: errMsg }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
