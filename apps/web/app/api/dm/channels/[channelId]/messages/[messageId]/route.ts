import { NextRequest, NextResponse } from "next/server"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { createDb, directMessages, dmAttachments, dmChannelMembers, dmReactions, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()
const senderUsers = alias(users, "message_sender_users")

const SENDER_COLUMNS = {
  id: senderUsers.id,
  username: senderUsers.username,
  displayName: senderUsers.displayName,
  avatarUrl: senderUsers.avatarUrl,
  status: senderUsers.status,
}

// GET /api/dm/channels/[channelId]/messages/[messageId] — fetch one enriched
// message (sender, reply_to, dm_attachments, reactions). Used by the client
// to hydrate a gateway "message.created" event, which only carries the id.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let membership: { userId: string } | undefined
    try {
      const rows = await db
        .select({ userId: dmChannelMembers.userId })
        .from(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
        .limit(1)
      membership = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
    }
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let message:
      | {
          id: string
          dmChannelId: string | null
          senderId: string
          content: string | null
          editedAt: string | null
          deletedAt: string | null
          createdAt: string
          replyToId: string | null
          sender: { id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string } | null
        }
      | undefined
    try {
      const rows = await db
        .select({
          id: directMessages.id,
          dmChannelId: directMessages.dmChannelId,
          senderId: directMessages.senderId,
          content: directMessages.content,
          editedAt: directMessages.editedAt,
          deletedAt: directMessages.deletedAt,
          createdAt: directMessages.createdAt,
          replyToId: directMessages.replyToId,
          sender: SENDER_COLUMNS,
        })
        .from(directMessages)
        .leftJoin(senderUsers, eq(directMessages.senderId, senderUsers.id))
        .where(and(eq(directMessages.id, messageId), eq(directMessages.dmChannelId, channelId)))
        .limit(1)
      message = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 })
    }
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    let replyTo: { id: string; content: string | null; senderId: string } | null = null
    if (message.replyToId) {
      try {
        const rows = await db
          .select({ id: directMessages.id, content: directMessages.content, senderId: directMessages.senderId })
          .from(directMessages)
          .where(
            and(
              eq(directMessages.id, message.replyToId),
              eq(directMessages.dmChannelId, channelId),
              isNull(directMessages.deletedAt)
            )
          )
          .limit(1)
        replyTo = rows[0] ?? null
      } catch {
        return NextResponse.json({ error: "Failed to fetch reply" }, { status: 500 })
      }
    }

    let attachmentRows: Array<{ id: string; filename: string; size: number; contentType: string }>
    try {
      attachmentRows = await db
        .select({ id: dmAttachments.id, filename: dmAttachments.filename, size: dmAttachments.size, contentType: dmAttachments.contentType })
        .from(dmAttachments)
        .where(eq(dmAttachments.dmId, messageId))
    } catch {
      return NextResponse.json({ error: "Failed to fetch attachments" }, { status: 500 })
    }

    let reactionRows: Array<{ dmId: string; userId: string; emoji: string; createdAt: string }>
    try {
      reactionRows = await db
        .select({ dmId: dmReactions.dmId, userId: dmReactions.userId, emoji: dmReactions.emoji, createdAt: dmReactions.createdAt })
        .from(dmReactions)
        .where(inArray(dmReactions.dmId, [messageId]))
    } catch {
      return NextResponse.json({ error: "Failed to fetch reactions" }, { status: 500 })
    }

    return NextResponse.json({
      ...toSnakeCase<Record<string, unknown>>(message),
      reply_to: replyTo ? toSnakeCase(replyTo) : null,
      dm_attachments: toSnakeCase(attachmentRows),
      reactions: toSnakeCase(reactionRows),
    })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/dm/channels/[channelId]/messages/[messageId] — edit a DM message
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limited = await checkRateLimit(user.id, "dm:edit", { limit: 30, windowMs: 60_000 })
    if (limited) return limited

    const body = await req.json()
    const content = body?.content
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content required" }, { status: 400 })
    }

    let data: typeof directMessages.$inferSelect | undefined
    try {
      const rows = await db
        .update(directMessages)
        .set({ content: content.trim(), editedAt: new Date().toISOString() })
        .where(
          and(
            eq(directMessages.id, messageId),
            eq(directMessages.senderId, user.id),
            eq(directMessages.dmChannelId, channelId)
          )
        )
        .returning()
      data = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to update message" }, { status: 500 })
    }

    if (!data) return NextResponse.json({ error: "Message not found or not editable" }, { status: 404 })

    return NextResponse.json(toSnakeCase(data))
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/dm/channels/[channelId]/messages/[messageId] — soft-delete a DM message
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limited = await checkRateLimit(user.id, "dm:delete", { limit: 30, windowMs: 60_000 })
    if (limited) return limited

    let data: { id: string } | undefined
    try {
      const rows = await db
        .update(directMessages)
        .set({ deletedAt: new Date().toISOString(), content: null })
        .where(
          and(
            eq(directMessages.id, messageId),
            eq(directMessages.senderId, user.id),
            eq(directMessages.dmChannelId, channelId)
          )
        )
        .returning({ id: directMessages.id })
      data = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
    }

    if (!data) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
