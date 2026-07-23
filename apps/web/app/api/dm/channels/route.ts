import { NextRequest, NextResponse, after } from "next/server"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { createDb, directMessages, dmChannelMembers, dmChannels, dmReadStates, users } from "@vortex/db"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

// GET /api/dm/channels — list all DM channels with unread counts
export async function GET() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    // 1. Get all channel IDs the user belongs to
    let memberships: Array<{ dmChannelId: string }>
    try {
      memberships = await db
        .select({ dmChannelId: dmChannelMembers.dmChannelId })
        .from(dmChannelMembers)
        .where(eq(dmChannelMembers.userId, user.id))
    } catch {
      return NextResponse.json({ error: "Failed to fetch DM channels" }, { status: 500 })
    }

    const channelIds = memberships.map((m) => m.dmChannelId)
    if (!channelIds.length) return NextResponse.json([])

    // 2-6. Fetch channel metadata, members, latest messages, and read states in parallel
    let channelRows, allMemberRows, latestRows, readRows
    try {
      ;[channelRows, allMemberRows, latestRows, readRows] = await Promise.all([
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
          })
          .from(dmChannels)
          .where(inArray(dmChannels.id, channelIds)),
        db
          .select({ dmChannelId: dmChannelMembers.dmChannelId, userId: dmChannelMembers.userId })
          .from(dmChannelMembers)
          .where(inArray(dmChannelMembers.dmChannelId, channelIds)),
        // One newest-message query per channel, not a single global-limit query — a global
        // `limit(channelIds.length * 5)` ordered across all channels combined can be entirely
        // consumed by a few very active channels, leaving quieter channels with zero rows
        // (and therefore no latestMessage) even though they do have messages.
        Promise.all(
          channelIds.map((id) =>
            db
              .select({
                dmChannelId: directMessages.dmChannelId,
                content: directMessages.content,
                createdAt: directMessages.createdAt,
                senderId: directMessages.senderId,
              })
              .from(directMessages)
              .where(and(eq(directMessages.dmChannelId, id), isNull(directMessages.deletedAt)))
              .orderBy(desc(directMessages.createdAt))
              .limit(1)
          )
        ).then((rows) => rows.flat()),
        db
          .select({ dmChannelId: dmReadStates.dmChannelId, lastReadAt: dmReadStates.lastReadAt })
          .from(dmReadStates)
          .where(and(eq(dmReadStates.userId, user.id), inArray(dmReadStates.dmChannelId, channelIds))),
      ])
    } catch {
      return NextResponse.json({ error: "Failed to fetch DM channels" }, { status: 500 })
    }

    // Fetch user profiles for all unique member IDs
    const allUserIds = Array.from(new Set(allMemberRows.map((m) => m.userId)))
    let userRows: Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string; statusMessage: string | null }>
    try {
      userRows = allUserIds.length
        ? await db
            .select({
              id: users.id,
              username: users.username,
              displayName: users.displayName,
              avatarUrl: users.avatarUrl,
              status: users.status,
              statusMessage: users.statusMessage,
            })
            .from(users)
            .where(inArray(users.id, allUserIds))
        : []
    } catch {
      return NextResponse.json({ error: "Failed to fetch user profiles" }, { status: 500 })
    }

    const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))

    // Build members-per-channel map
    const membersByChannel: Record<string, typeof userRows> = {}
    for (const row of allMemberRows) {
      if (!membersByChannel[row.dmChannelId]) membersByChannel[row.dmChannelId] = []
      const u = userMap[row.userId]
      if (u) membersByChannel[row.dmChannelId]!.push(u)
    }

    const latestMessages: Record<string, (typeof latestRows)[number]> = {}
    for (const msg of latestRows) {
      if (msg.dmChannelId && !latestMessages[msg.dmChannelId]) {
        latestMessages[msg.dmChannelId] = msg
      }
    }

    const readStates: Record<string, string> = {}
    for (const r of readRows) {
      readStates[r.dmChannelId] = r.lastReadAt
    }

    // 7. Assemble result
    const channels = channelRows.map((ch) => {
      const members = membersByChannel[ch.id] ?? []
      const partner = ch.isGroup ? null : (members.find((u) => u.id !== user.id) ?? null)
      const latest = latestMessages[ch.id] ?? null
      const lastRead = readStates[ch.id]
      const isUnread = !!(latest && (!lastRead || latest.createdAt > lastRead) && latest.senderId !== user.id)

      return {
        id: ch.id,
        name: ch.name,
        iconUrl: ch.iconUrl,
        isGroup: ch.isGroup,
        ownerId: ch.ownerId,
        updatedAt: ch.updatedAt,
        isEncrypted: ch.isEncrypted,
        members,
        partner,
        latestMessage: latest ? { ...latest, content: ch.isEncrypted ? "Encrypted message" : latest.content } : null,
        isUnread,
      }
    })

    channels.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    return NextResponse.json(toSnakeCase(channels), {
      headers: { "Cache-Control": "private, max-age=5" },
    })
  } catch (err) {
    console.error("[dm/channels GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/dm/channels — open/create a DM channel
// Body: { userIds: string[], name?: string } (userIds = partner(s), name for group)
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "dm:create", { limit: 20, windowMs: 3600_000 })
    if (limited) return limited

    const { data: parsedBody, error: parseError } = await parseJsonBody<{ userIds?: string[]; name?: string; encrypted?: boolean }>(req)
    if (parseError) return parseError

    const { userIds, name } = parsedBody
    const encrypted = parsedBody.encrypted === true
    if (!userIds?.length) return NextResponse.json({ error: "userIds required" }, { status: 400 })

    const allMembers = Array.from(new Set([user.id, ...userIds])) as string[]
    const isGroup = allMembers.length > 2

    if (!isGroup) {
      const partnerId = userIds[0] as string

      // Find existing 1:1 channel between current user and partner — fetch in parallel
      let userMems, partnerMems
      try {
        ;[userMems, partnerMems] = await Promise.all([
          db.select({ dmChannelId: dmChannelMembers.dmChannelId }).from(dmChannelMembers).where(eq(dmChannelMembers.userId, user.id)),
          db.select({ dmChannelId: dmChannelMembers.dmChannelId }).from(dmChannelMembers).where(eq(dmChannelMembers.userId, partnerId)),
        ])
      } catch {
        return NextResponse.json({ error: "Failed to check existing channels" }, { status: 500 })
      }

      const userChannelIds = new Set(userMems.map((m) => m.dmChannelId))
      const sharedChannelIds = partnerMems.map((m) => m.dmChannelId).filter((id) => userChannelIds.has(id))

      if (sharedChannelIds.length > 0) {
        // Get non-group channels from those IDs
        let nonGroupChannels
        try {
          nonGroupChannels = await db
            .select({ id: dmChannels.id, isEncrypted: dmChannels.isEncrypted })
            .from(dmChannels)
            .where(
              and(
                inArray(dmChannels.id, sharedChannelIds),
                eq(dmChannels.isGroup, false),
                eq(dmChannels.isEncrypted, encrypted)
              )
            )
        } catch {
          return NextResponse.json({ error: "Failed to check existing channels" }, { status: 500 })
        }

        const existingChannel = nonGroupChannels[0]
        if (existingChannel) {
          return NextResponse.json({ id: existingChannel.id, existing: true })
        }
      }
    }

    // Create the channel and add all members atomically — either both commit or neither does.
    // better-sqlite3's transaction() is synchronous-only (see issue #4's spike), so the
    // callback below uses .get()/.run() rather than awaited query builders.
    let channel: typeof dmChannels.$inferSelect
    try {
      channel = db.transaction((tx) => {
        const row = tx
          .insert(dmChannels)
          .values({ name: name ?? null, isGroup, ownerId: user.id, isEncrypted: encrypted })
          .returning()
          .get()

        tx.insert(dmChannelMembers)
          .values(allMembers.map((uid) => ({ dmChannelId: row.id, userId: uid, addedBy: user.id })))
          .run()

        return row
      })
    } catch {
      return NextResponse.json({ error: "Failed to create DM channel" }, { status: 500 })
    }

    // Notify the other member(s) so their DM list picks up the new channel —
    // the creator's own client already has the channel id from this response.
    for (const memberId of allMembers) {
      if (memberId === user.id) continue
      after(() => publishGatewayEvent({
        type: "member.joined",
        channelId: `user:${memberId}`,
        actorId: user.id,
        data: { channelId: channel.id },
      }, { route: "/api/dm/channels" }))
    }

    return NextResponse.json({ id: channel.id, existing: false }, { status: 201 })
  } catch (err) {
    console.error("[dm/channels POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
