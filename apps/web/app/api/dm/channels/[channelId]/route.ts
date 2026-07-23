import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import {
  createDb,
  directMessages,
  dmAttachments,
  dmChannelMembers,
  dmChannels,
  dmReactions,
  dmReadStates,
  users,
} from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()
const senderUsers = alias(users, "sender_users")

const USER_PROFILE_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  status: users.status,
  statusMessage: users.statusMessage,
}

const SENDER_COLUMNS = {
  id: senderUsers.id,
  username: senderUsers.username,
  displayName: senderUsers.displayName,
  avatarUrl: senderUsers.avatarUrl,
  status: senderUsers.status,
}

// GET /api/dm/channels/[channelId] — get channel info + messages
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify membership
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

    // Fetch channel info and member user_ids in parallel
    let channel: {
      id: string
      name: string | null
      iconUrl: string | null
      isGroup: boolean
      ownerId: string | null
      updatedAt: string
      isEncrypted: boolean
      encryptionKeyVersion: number
      encryptionMembershipEpoch: number
      themePreset: typeof dmChannels.$inferSelect["themePreset"]
    } | undefined
    let memberRows: Array<{ userId: string }>
    try {
      const [channelRows, memberIdRows] = await Promise.all([
        db
          .select({
            id: dmChannels.id,
            name: dmChannels.name,
            iconUrl: dmChannels.iconUrl,
            isGroup: dmChannels.isGroup,
            ownerId: dmChannels.ownerId,
            updatedAt: dmChannels.updatedAt,
            isEncrypted: dmChannels.isEncrypted,
            encryptionKeyVersion: dmChannels.encryptionKeyVersion,
            encryptionMembershipEpoch: dmChannels.encryptionMembershipEpoch,
            themePreset: dmChannels.themePreset,
          })
          .from(dmChannels)
          .where(eq(dmChannels.id, channelId))
          .limit(1),
        db.select({ userId: dmChannelMembers.userId }).from(dmChannelMembers).where(eq(dmChannelMembers.dmChannelId, channelId)),
      ])
      channel = channelRows[0]
      memberRows = memberIdRows
    } catch {
      return NextResponse.json({ error: "Failed to fetch DM channel" }, { status: 500 })
    }

    if (!channel) return NextResponse.json({ error: "DM channel not found" }, { status: 404 })

    const memberIds = memberRows.map((r) => r.userId)

    // Fetch user profiles for members
    type MemberUser = { id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string; statusMessage: string | null }
    let memberUsers: MemberUser[]
    try {
      memberUsers = memberIds.length
        ? await db.select(USER_PROFILE_COLUMNS).from(users).where(inArray(users.id, memberIds))
        : []
    } catch {
      return NextResponse.json({ error: "Failed to fetch member profiles" }, { status: 500 })
    }

    const members = memberUsers
    const partner = channel && !channel.isGroup
      ? (members.find((u) => u.id !== user.id) ?? null)
      : null

    // Fetch messages with pagination
    const { searchParams } = new URL(req.url)
    const before = searchParams.get("before")
    const limit = 50

    const conditions = [eq(directMessages.dmChannelId, channelId), isNull(directMessages.deletedAt)]
    if (before) conditions.push(lt(directMessages.createdAt, before))

    let rawMessages: Array<{
      id: string
      dmChannelId: string | null
      senderId: string
      content: string | null
      editedAt: string | null
      deletedAt: string | null
      createdAt: string
      replyToId: string | null
      sender: { id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string } | null
    }>
    try {
      rawMessages = await db
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
        .where(and(...conditions))
        .orderBy(desc(directMessages.createdAt))
        .limit(limit)
    } catch {
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
    }

    const messages = rawMessages

    // Resolve replied-to messages
    const replyIds: string[] = messages
      .map((m) => m.replyToId)
      .filter((id): id is string => !!id)
    const uniqueReplyIds: string[] = [...new Set(replyIds)]

    let replyMap: Record<string, Record<string, unknown>> = {}
    if (uniqueReplyIds.length > 0) {
      const replyMessages = await db
        .select({
          id: directMessages.id,
          content: directMessages.content,
          senderId: directMessages.senderId,
          sender: SENDER_COLUMNS,
        })
        .from(directMessages)
        .leftJoin(senderUsers, eq(directMessages.senderId, senderUsers.id))
        .where(
          and(
            inArray(directMessages.id, uniqueReplyIds),
            eq(directMessages.dmChannelId, channelId),
            isNull(directMessages.deletedAt)
          )
        )
      if (replyMessages.length) {
        replyMap = Object.fromEntries(
          replyMessages.map((m) => [
            m.id,
            {
              ...toSnakeCase<Record<string, unknown>>({ id: m.id, content: m.content, senderId: m.senderId }),
              sender: m.sender ? toSnakeCase(m.sender) : null,
            },
          ])
        )
      }
    }

    // Fetch dm_attachments and dm_reactions for these messages in parallel
    const messageIds: string[] = messages.map((m) => m.id)
    let attachmentMap: Record<string, Array<{ id: string; filename: string; size: number; content_type: string }>> = {}
    let reactionMap: Record<string, Array<{ dm_id: string; user_id: string; emoji: string; created_at: string }>> = {}
    if (messageIds.length > 0) {
      const [attachmentRows, reactionRows] = await Promise.all([
        db
          .select({ id: dmAttachments.id, dmId: dmAttachments.dmId, filename: dmAttachments.filename, size: dmAttachments.size, contentType: dmAttachments.contentType })
          .from(dmAttachments)
          .where(inArray(dmAttachments.dmId, messageIds)),
        db
          .select({ dmId: dmReactions.dmId, userId: dmReactions.userId, emoji: dmReactions.emoji, createdAt: dmReactions.createdAt })
          .from(dmReactions)
          .where(inArray(dmReactions.dmId, messageIds)),
      ])
      for (const att of attachmentRows) {
        if (!attachmentMap[att.dmId]) attachmentMap[att.dmId] = []
        attachmentMap[att.dmId].push({ id: att.id, filename: att.filename, size: att.size, content_type: att.contentType })
      }
      for (const r of reactionRows) {
        if (!reactionMap[r.dmId]) reactionMap[r.dmId] = []
        reactionMap[r.dmId].push({ dm_id: r.dmId, user_id: r.userId, emoji: r.emoji, created_at: r.createdAt })
      }
    }

    const enrichedMessages = messages.map((m) => ({
      ...toSnakeCase<Record<string, unknown>>({
        id: m.id,
        dmChannelId: m.dmChannelId,
        senderId: m.senderId,
        content: m.content,
        editedAt: m.editedAt,
        deletedAt: m.deletedAt,
        createdAt: m.createdAt,
        replyToId: m.replyToId,
      }),
      sender: m.sender ? toSnakeCase(m.sender) : null,
      reply_to: m.replyToId ? (replyMap[m.replyToId] ?? null) : null,
      dm_attachments: attachmentMap[m.id] ?? [],
      reactions: reactionMap[m.id] ?? [],
    }))

    // Mark as read
    const nowIso = new Date().toISOString()
    await db
      .insert(dmReadStates)
      .values({ userId: user.id, dmChannelId: channelId, lastReadAt: nowIso })
      .onConflictDoUpdate({
        target: [dmReadStates.userId, dmReadStates.dmChannelId],
        set: { lastReadAt: nowIso },
      })

    return NextResponse.json({
      channel: { ...toSnakeCase<Record<string, unknown>>(channel), members: toSnakeCase(members), partner: partner ? toSnakeCase(partner) : null },
      messages: enrichedMessages.reverse(),
      has_more: messages.length === limit,
    })

  } catch (err) {
    console.error("[dm/channels/[channelId] GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
