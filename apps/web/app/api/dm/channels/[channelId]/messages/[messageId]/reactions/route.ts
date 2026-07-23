import { NextRequest, NextResponse, after } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { createDb, directMessages, dmChannelMembers, dmReactions } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { publishGatewayEvent } from "@/lib/gateway-publish"

const db = createDb()

interface Body {
  emoji?: string
  nonce?: string
}

function normalizeEmoji(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  return value.slice(0, 64)
}

async function verifyMembershipAndMessage(
  channelId: string,
  messageId: string,
  userId: string
): Promise<{ error: NextResponse | null; message: { id: string; senderId: string } | null }> {
  // Verify the user is a member of this DM channel
  let membership: { userId: string } | undefined
  try {
    const rows = await db
      .select({ userId: dmChannelMembers.userId })
      .from(dmChannelMembers)
      .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, userId)))
      .limit(1)
    membership = rows[0]
  } catch {
    return { error: NextResponse.json({ error: "Failed to verify membership" }, { status: 500 }), message: null }
  }
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), message: null }

  // Verify the message exists in this channel
  let message: { id: string; senderId: string } | undefined
  try {
    const rows = await db
      .select({ id: directMessages.id, senderId: directMessages.senderId })
      .from(directMessages)
      .where(
        and(
          eq(directMessages.id, messageId),
          eq(directMessages.dmChannelId, channelId),
          isNull(directMessages.deletedAt)
        )
      )
      .limit(1)
    message = rows[0]
  } catch {
    return { error: NextResponse.json({ error: "Failed to fetch message" }, { status: 500 }), message: null }
  }

  if (!message) return { error: NextResponse.json({ error: "Message not found" }, { status: 404 }), message: null }

  return { error: null, message }
}

// POST — add a reaction to a DM message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const emoji = normalizeEmoji(body.emoji)
    if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 })

    const { error: verifyError, message } = await verifyMembershipAndMessage(channelId, messageId, user.id)
    if (verifyError) return verifyError
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    if (await isBlockedBetweenUsers(user.id, message.senderId)) {
      return NextResponse.json({ error: "Cannot react due to block state" }, { status: 403 })
    }

    try {
      await db
        .insert(dmReactions)
        .values({ dmId: messageId, userId: user.id, emoji })
        .onConflictDoNothing({ target: [dmReactions.dmId, dmReactions.userId, dmReactions.emoji] })
    } catch (err) {
      console.error("[dm reactions POST] upsert error:", { messageId, userId: user.id, emoji, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 })
    }

    after(() => publishGatewayEvent({
      type: "reaction.added",
      channelId,
      actorId: user.id,
      data: { dm_id: messageId, user_id: user.id, emoji, created_at: new Date().toISOString() },
    }, { route: "/api/dm/channels/[channelId]/messages/[messageId]/reactions" }))

    return NextResponse.json({ ok: true, emoji, nonce: body.nonce ?? null })
  } catch (err) {
    console.error("[dm reactions POST] error:", { action: "createReaction", error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE — remove a reaction from a DM message
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const emoji = normalizeEmoji(body.emoji)
    if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 })

    const { error: verifyError } = await verifyMembershipAndMessage(channelId, messageId, user.id)
    if (verifyError) return verifyError

    try {
      await db
        .delete(dmReactions)
        .where(and(eq(dmReactions.dmId, messageId), eq(dmReactions.userId, user.id), eq(dmReactions.emoji, emoji)))
    } catch (err) {
      console.error("[dm reactions DELETE] delete error:", { messageId, userId: user.id, emoji, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 })
    }

    after(() => publishGatewayEvent({
      type: "reaction.removed",
      channelId,
      actorId: user.id,
      data: { dm_id: messageId, user_id: user.id, emoji, created_at: new Date().toISOString() },
    }, { route: "/api/dm/channels/[channelId]/messages/[messageId]/reactions" }))

    return NextResponse.json({ ok: true, emoji, nonce: body.nonce ?? null })
  } catch (err) {
    console.error("[dm reactions DELETE] error:", { action: "deleteReaction", error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
