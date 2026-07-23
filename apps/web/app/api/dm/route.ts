import { NextResponse } from "next/server"
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { createDb, directMessages, dmAttachments, dmReactions, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { createLogger } from "@/lib/logger"
import { toSnakeCase } from "@/lib/utils/case"

const log = createLogger("api/dm")
const db = createDb()

export async function GET(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const partnerId = searchParams.get("partnerId")

    if (!partnerId) {
      // Return all DM conversations (latest message per partner) — fetch in parallel
      const [sent, received] = await Promise.all([
        db
          .select({ receiverId: directMessages.receiverId, createdAt: directMessages.createdAt })
          .from(directMessages)
          .where(eq(directMessages.senderId, user.id))
          .orderBy(desc(directMessages.createdAt)),
        db
          .select({ senderId: directMessages.senderId, createdAt: directMessages.createdAt })
          .from(directMessages)
          .where(eq(directMessages.receiverId, user.id))
          .orderBy(desc(directMessages.createdAt)),
      ])

      const partnerIds = new Set<string>([
        ...sent.map((m) => m.receiverId).filter((id): id is string => id !== null),
        ...received.map((m) => m.senderId),
      ])

      if (partnerIds.size === 0) return NextResponse.json([])

      const partners = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          status: users.status,
          statusMessage: users.statusMessage,
        })
        .from(users)
        .where(inArray(users.id, Array.from(partnerIds)))

      return NextResponse.json(toSnakeCase(partners))
    }

    // Validate partnerId is a valid UUID to prevent PostgREST filter injection
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(partnerId)) {
      return NextResponse.json({ error: "Invalid partnerId" }, { status: 400 })
    }

    // Get messages with specific partner
    let messages: Array<{
      id: string
      senderId: string
      receiverId: string | null
      content: string | null
      createdAt: string
      editedAt: string | null
      deletedAt: string | null
      replyToId: string | null
    }>
    try {
      messages = await db
        .select({
          id: directMessages.id,
          senderId: directMessages.senderId,
          receiverId: directMessages.receiverId,
          content: directMessages.content,
          createdAt: directMessages.createdAt,
          editedAt: directMessages.editedAt,
          deletedAt: directMessages.deletedAt,
          replyToId: directMessages.replyToId,
        })
        .from(directMessages)
        .where(
          and(
            isNull(directMessages.deletedAt),
            or(
              and(eq(directMessages.senderId, user.id), eq(directMessages.receiverId, partnerId)),
              and(eq(directMessages.senderId, partnerId), eq(directMessages.receiverId, user.id))
            )
          )
        )
        .orderBy(asc(directMessages.createdAt))
        .limit(100)
    } catch {
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
    }

    const messageIds = messages.map((m) => m.id)
    let attachmentsByMessage: Record<string, Array<Record<string, unknown>>> = {}
    let reactionsByMessage: Record<string, Array<Record<string, unknown>>> = {}
    if (messageIds.length > 0) {
      const [attachmentRows, reactionRows] = await Promise.all([
        db.select().from(dmAttachments).where(inArray(dmAttachments.dmId, messageIds)),
        db.select().from(dmReactions).where(inArray(dmReactions.dmId, messageIds)),
      ])
      attachmentsByMessage = {}
      for (const row of attachmentRows) {
        const snake = toSnakeCase<Record<string, unknown>>(row)
        const list = attachmentsByMessage[row.dmId] ?? []
        list.push(snake)
        attachmentsByMessage[row.dmId] = list
      }
      reactionsByMessage = {}
      for (const row of reactionRows) {
        const snake = toSnakeCase<Record<string, unknown>>(row)
        const list = reactionsByMessage[row.dmId] ?? []
        list.push(snake)
        reactionsByMessage[row.dmId] = list
      }
    }

    const enriched = messages.map((m) => ({
      ...toSnakeCase<Record<string, unknown>>(m),
      dm_attachments: attachmentsByMessage[m.id] ?? [],
      reactions: reactionsByMessage[m.id] ?? [],
    }))

    return NextResponse.json(enriched)

  } catch (err) {
    log.error({ route: "/api/dm", action: "GET", error: err }, "GET error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const MAX_DM_CONTENT_LENGTH = 4000

export async function POST(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Rate limit: 15 messages per 10 seconds (matches newer DM route)
    const limited = await checkRateLimit(user.id, "dm:send", { limit: 15, windowMs: 10_000 })
    if (limited) return limited

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })
    }

    const receiverId = (payload as Record<string, unknown>).receiverId
    const content = (payload as Record<string, unknown>).content
    if (typeof receiverId !== "string" || typeof content !== "string") {
      return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })
    }

    const trimmed = content.trim()
    if (!receiverId || !trimmed) {
      return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })
    }

    // Validate receiverId is a valid UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(receiverId)) {
      return NextResponse.json({ error: "Invalid receiverId" }, { status: 400 })
    }

    // Content length validation
    if (trimmed.length > MAX_DM_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content exceeds maximum length of ${MAX_DM_CONTENT_LENGTH} characters` },
        { status: 400 },
      )
    }

    // Block check: prevent messaging blocked users
    const blocked = await isBlockedBetweenUsers(user.id, receiverId)
    if (blocked) {
      return NextResponse.json({ error: "Cannot send message to this user" }, { status: 403 })
    }

    let inserted: typeof directMessages.$inferSelect
    try {
      const [row] = await db
        .insert(directMessages)
        .values({ senderId: user.id, receiverId, content: trimmed })
        .returning()
      if (!row) throw new Error("insert returned no row")
      inserted = row
    } catch {
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
    }

    return NextResponse.json(toSnakeCase(inserted), { status: 201 })

  } catch (err) {
    log.error({ route: "/api/dm", action: "POST", error: err }, "POST error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
