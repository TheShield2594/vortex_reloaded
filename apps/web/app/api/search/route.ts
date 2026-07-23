import { NextRequest, NextResponse } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { createDb, dmChannelMembers, users } from "@vortex/db"
import { requireAuth } from "@/lib/utils/api-helpers"
import { filterBlockedUserIds, getBlockedUserIdsForViewer } from "@/lib/social-block-policy"
import { rateLimiter } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { toSnakeCase } from "@/lib/utils/case"

const log = createLogger("api/search")
const db = createDb()

interface DmSearchRow {
  id: string
  dm_channel_id: string | null
  content: string | null
  created_at: string
  sender_id: string
}

interface SearchFilters {
  fromUserId?: string
  has?: "link" | "image" | "file"
  before?: string
  after?: string
}

function parseSearchQuery(raw: string): { query: string; filters: SearchFilters } {
  const filters: SearchFilters = {}
  let query = raw

  const fromMatch = query.match(/(?:^|\s)from:([^\s]+)/i)
  if (fromMatch?.[1]) {
    filters.fromUserId = fromMatch[1].trim()
    query = query.replace(fromMatch[0], " ")
  }

  const hasMatches = Array.from(query.matchAll(/(?:^|\s)has:(link|image|file)/ig))
  const lastHasMatch = hasMatches.at(-1)
  if (lastHasMatch?.[1]) {
    filters.has = lastHasMatch[1].toLowerCase() as SearchFilters["has"]
    query = query.replace(/(?:^|\s)has:(?:link|image|file)/ig, " ")
  }

  const beforeMatch = query.match(/(?:^|\s)before:([^\s]+)/i)
  if (beforeMatch?.[1]) {
    const candidate = new Date(beforeMatch[1].trim())
    if (!Number.isNaN(candidate.getTime())) {
      filters.before = candidate.toISOString()
    }
    query = query.replace(beforeMatch[0], " ")
  }

  const afterMatch = query.match(/(?:^|\s)after:([^\s]+)/i)
  if (afterMatch?.[1]) {
    const candidate = new Date(afterMatch[1].trim())
    if (!Number.isNaN(candidate.getTime())) {
      filters.after = candidate.toISOString()
    }
    query = query.replace(afterMatch[0], " ")
  }

  return { query: query.replace(/\s+/g, " ").trim(), filters }
}

// Search within a single DM/group channel the caller is a member of.
export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    // Rate limit: 10 searches per minute per user
    const rl = await rateLimiter.check(`search:${user.id}`, { limit: 10, windowMs: 60_000 })
    if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 })

    const { searchParams } = new URL(req.url)
    const rawQuery = searchParams.get("q")?.trim() ?? ""
    const dmChannelId = searchParams.get("dmChannelId")
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "25", 10), 100)

    if (!rawQuery) return NextResponse.json({ error: "q required" }, { status: 400 })
    if (rawQuery.length > 500) return NextResponse.json({ error: "Query too long (max 500 chars)" }, { status: 400 })
    if (!dmChannelId) {
      return NextResponse.json({ error: "dmChannelId required" }, { status: 400 })
    }

    const { query, filters } = parseSearchQuery(rawQuery)

    // Verify the user is a member of this DM channel
    let membership: { userId: string } | undefined
    try {
      const rows = await db
        .select({ userId: dmChannelMembers.userId })
        .from(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, dmChannelId), eq(dmChannelMembers.userId, user.id)))
        .limit(1)
      membership = rows[0]
    } catch (membershipError) {
      log.error({ route: "/api/search", action: "dmMembershipCheck", dmChannelId, userId: user.id, error: membershipError instanceof Error ? membershipError.message : String(membershipError) }, "DM membership check failed")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Drizzle has no schema-level FTS5 support (see
    // docs/sqlite-migration-fts5-transactions-spike.md) — query the
    // direct_messages_fts virtual table (packages/db/src/sql/fts5-and-triggers.sql)
    // directly via the underlying better-sqlite3 client.
    const conditions: string[] = ["dm.dm_channel_id = ?", "dm.deleted_at IS NULL"]
    const params: Array<string> = [dmChannelId]

    if (filters.fromUserId) {
      conditions.push("dm.sender_id = ?")
      params.push(filters.fromUserId)
    }
    if (filters.before) {
      conditions.push("dm.created_at < ?")
      params.push(filters.before)
    }
    if (filters.after) {
      conditions.push("dm.created_at > ?")
      params.push(filters.after)
    }
    if (filters.has === "link") {
      conditions.push("dm.content LIKE '%http%'")
    }
    if (filters.has === "image") {
      conditions.push("(dm.content LIKE '%http%.png%' OR dm.content LIKE '%http%.jpg%' OR dm.content LIKE '%http%.jpeg%' OR dm.content LIKE '%http%.gif%' OR dm.content LIKE '%http%.webp%')")
    }
    if (filters.has === "file") {
      conditions.push("(dm.content LIKE '%.pdf%' OR dm.content LIKE '%.docx%' OR dm.content LIKE '%.xlsx%' OR dm.content LIKE '%.zip%' OR dm.content LIKE '%.mp3%' OR dm.content LIKE '%.mp4%')")
    }

    let dmMessages: DmSearchRow[]
    try {
      if (query) {
        const sqlText = `
          SELECT dm.id, dm.dm_channel_id, dm.content, dm.created_at, dm.sender_id
          FROM direct_messages_fts
          JOIN direct_messages dm ON dm.rowid = direct_messages_fts.rowid
          WHERE direct_messages_fts MATCH ? AND ${conditions.join(" AND ")}
          ORDER BY bm25(direct_messages_fts)
          LIMIT ?
        `
        dmMessages = db.$client.prepare(sqlText).all(query, ...params, limit) as DmSearchRow[]
      } else {
        const sqlText = `
          SELECT dm.id, dm.dm_channel_id, dm.content, dm.created_at, dm.sender_id
          FROM direct_messages dm
          WHERE ${conditions.join(" AND ")}
          ORDER BY dm.created_at DESC
          LIMIT ?
        `
        dmMessages = db.$client.prepare(sqlText).all(...params, limit) as DmSearchRow[]
      }
    } catch (dmError) {
      log.error({ route: "/api/search", action: "dmSearch", dmChannelId, userId: user.id, error: dmError instanceof Error ? dmError.message : String(dmError) }, "DM search query failed")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const senderIds = Array.from(new Set(dmMessages.map((m) => m.sender_id)))
    const senderRows = senderIds.length
      ? await db
          .select({ id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, senderIds))
      : []
    const senderMap = Object.fromEntries(senderRows.map((s) => [s.id, toSnakeCase(s)]))

    const blockedUserIds = await getBlockedUserIdsForViewer(user.id)
    const visibleDMs = filterBlockedUserIds(
      dmMessages,
      (msg) => msg.sender_id,
      blockedUserIds,
    )

    const results = visibleDMs.map((m) => ({
      type: "dm" as const,
      id: m.id,
      content: m.content,
      channel_id: m.dm_channel_id,
      created_at: m.created_at,
      author_id: m.sender_id,
      author: senderMap[m.sender_id] ?? null,
    }))

    return NextResponse.json({ results, total: results.length }, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" },
    })
  } catch (err) {
    log.error({ route: "/api/search", action: "GET", error: err }, "GET error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
