import { NextRequest, NextResponse, after } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { createDb, directMessages, dmChannelMembers, dmChannels, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { sendPushToChannel } from "@/lib/push"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { createLogger } from "@/lib/logger"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import { toSnakeCase } from "@/lib/utils/case"

const log = createLogger("api/dm/messages")
const db = createDb()
const senderUsers = alias(users, "sender_users")

const SENDER_COLUMNS = {
  id: senderUsers.id,
  username: senderUsers.username,
  displayName: senderUsers.displayName,
  avatarUrl: senderUsers.avatarUrl,
  status: senderUsers.status,
}

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

function isValidSignalCiphertextShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (v.type === 0 || v.type === 1) && typeof v.body === "string" && v.body.length > 0
}

// Signal Protocol envelopes carry one Olm ciphertext per recipient *device*
// (see lib/signal-protocol.ts) — used for both 1:1 and group DM channels
// alike, no separate group-ratchet envelope (issue #3: pairwise Double
// Ratchet per conversation, not Megolm). The server only validates shape;
// it never sees plaintext or holds any private key.
function isValidDmSignalEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const envelope = value as Record<string, unknown>
  if (envelope.kind !== "dm-signal" || envelope.v !== 1) return false
  if (typeof envelope.senderDeviceId !== "string" || envelope.senderDeviceId.length === 0) return false
  const ciphertexts = envelope.ciphertexts
  if (!ciphertexts || typeof ciphertexts !== "object" || Array.isArray(ciphertexts)) return false
  const entries = Object.entries(ciphertexts as Record<string, unknown>)
  if (entries.length === 0) return false
  return entries.every(([key, ct]) => typeof key === "string" && key.includes(":") && isValidSignalCiphertextShape(ct))
}


// POST /api/dm/channels/[channelId]/messages — send a message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
  const { channelId } = await params
  const { data: { user } } = await getBetterAuthUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const limited = await checkRateLimit(user.id, "dm:send", { limit: 15, windowMs: 10_000 })
  if (limited) return limited

  // Fetch all channel members (verifies membership and gets other member IDs in one query)
  let channelMembers: Array<{ userId: string }>
  try {
    channelMembers = await db
      .select({ userId: dmChannelMembers.userId })
      .from(dmChannelMembers)
      .where(eq(dmChannelMembers.dmChannelId, channelId))
  } catch {
    return NextResponse.json({ error: "Failed to load DM members" }, { status: 500 })
  }

  if (!channelMembers.some((member) => member.userId === user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const otherMemberIds = channelMembers
    .filter((member) => member.userId !== user.id)
    .map((member) => member.userId)

  // Run blocking checks, body parsing, and channel encryption fetch in parallel
  const [blockCheckResult, bodyResult, channelResult] = await Promise.all([
    Promise.all(
      otherMemberIds.map((memberId) => isBlockedBetweenUsers(user.id, memberId))
    ).then((results) => ({ blocked: results.some(Boolean), error: null as Error | null }))
     .catch((error: Error) => ({ blocked: false, error })),
    req.json().then((b: unknown) => ({ body: b as { content?: string; reply_to_id?: string }, error: null as string | null }))
      .catch(() => ({ body: null as { content?: string; reply_to_id?: string } | null, error: "Invalid JSON body" })),
    db
      .select({
        isEncrypted: dmChannels.isEncrypted,
        encryptionKeyVersion: dmChannels.encryptionKeyVersion,
        encryptionScheme: dmChannels.encryptionScheme,
      })
      .from(dmChannels)
      .where(eq(dmChannels.id, channelId))
      .limit(1)
      .then((rows) => ({ data: rows[0] ?? null, error: null as Error | null }))
      .catch((error: Error) => ({ data: null, error })),
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

  if (channelInfo?.isEncrypted) {
    try {
      const parsed = JSON.parse(content)
      if (channelInfo.encryptionScheme === "signal-protocol") {
        if (!isValidDmSignalEnvelope(parsed)) {
          return NextResponse.json({ error: "Encrypted channels require encrypted payload" }, { status: 400 })
        }
      } else {
        if (!isValidDmE2eeEnvelope(parsed)) {
          return NextResponse.json({ error: "Encrypted channels require encrypted payload" }, { status: 400 })
        }
        if ((parsed as { keyVersion: number }).keyVersion !== channelInfo.encryptionKeyVersion) {
          return NextResponse.json({ error: "Encrypted channels require current keyVersion" }, { status: 400 })
        }
      }
    } catch {
      return NextResponse.json({ error: "Encrypted channels require encrypted payload" }, { status: 400 })
    }
  }

  // Validate reply_to_id and fetch full reply data in one query (avoids redundant re-fetch after insert)
  const replyToId = body.reply_to_id ?? null
  let replyToMessage: Record<string, unknown> | null = null
  if (replyToId) {
    const [replyTarget] = await db
      .select({
        id: directMessages.id,
        dmChannelId: directMessages.dmChannelId,
        content: directMessages.content,
        senderId: directMessages.senderId,
        sender: SENDER_COLUMNS,
      })
      .from(directMessages)
      .leftJoin(senderUsers, eq(directMessages.senderId, senderUsers.id))
      .where(and(eq(directMessages.id, replyToId), isNull(directMessages.deletedAt)))
      .limit(1)

    if (!replyTarget) {
      return NextResponse.json({ error: "Replied-to message not found" }, { status: 400 })
    }
    if (replyTarget.dmChannelId !== channelId) {
      return NextResponse.json({ error: "Replied-to message must be in the same channel" }, { status: 400 })
    }
    replyToMessage = {
      ...toSnakeCase<Record<string, unknown>>({ id: replyTarget.id, dmChannelId: replyTarget.dmChannelId, content: replyTarget.content, senderId: replyTarget.senderId }),
      sender: replyTarget.sender ? toSnakeCase(replyTarget.sender) : null,
    }
  }

  let message: typeof directMessages.$inferSelect
  try {
    const [row] = await db
      .insert(directMessages)
      .values({
        dmChannelId: channelId,
        senderId: user.id,
        content,
        ...(replyToId ? { replyToId } : {}),
      })
      .returning()
    if (!row) throw new Error("insert returned no row")
    message = row
  } catch {
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }

  const [senderProfile] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl, status: users.status })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  // Send push notifications (fire-and-forget)
  const senderName = senderProfile?.displayName || senderProfile?.username || "Someone"
  sendPushToChannel({
    dmChannelId: channelId,
    senderName,
    senderAvatarUrl: senderProfile?.avatarUrl ?? null,
    content: channelInfo?.isEncrypted ? "Encrypted message" : content,
    excludeUserId: user.id,
  }).catch(() => {})

  after(() => publishGatewayEvent({
    type: "message.created",
    channelId,
    actorId: user.id,
    data: { messageId: message.id, replyToId, content },
  }, { route: "/api/dm/channels/[channelId]/messages" }))

  const responseBody = {
    ...toSnakeCase<Record<string, unknown>>(message),
    sender: senderProfile ? toSnakeCase(senderProfile) : null,
    reply_to_id: replyToId,
    reply_to: replyToMessage,
  }

  return NextResponse.json(responseBody, { status: 201 })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"
    log.error({ route: "/api/dm/channels/[channelId]/messages", action: "POST", error: errMsg }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
