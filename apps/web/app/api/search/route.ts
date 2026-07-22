import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import { filterBlockedUserIds, getBlockedUserIdsForViewer } from "@/lib/social-block-policy"
import { rateLimiter } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/search")

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
    const { supabase, user, error: authError } = await requireAuth()
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
    const { data: membership, error: membershipError } = await supabase
      .from("dm_channel_members")
      .select("user_id")
      .eq("dm_channel_id", dmChannelId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) {
      log.error({ route: "/api/search", action: "dmMembershipCheck", dmChannelId, userId: user.id, error: membershipError.message }, "DM membership check failed")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let dmQuery = supabase
      .from("direct_messages")
      .select("id, content, dm_channel_id, created_at, sender_id, sender:users!direct_messages_sender_id_fkey(id, username, display_name, avatar_url)")
      .eq("dm_channel_id", dmChannelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (query) {
      dmQuery = dmQuery.textSearch("search_vector", query, { type: "websearch", config: "english" })
    }
    if (filters.fromUserId) {
      dmQuery = dmQuery.eq("sender_id", filters.fromUserId)
    }
    if (filters.before) {
      dmQuery = dmQuery.lt("created_at", filters.before)
    }
    if (filters.after) {
      dmQuery = dmQuery.gt("created_at", filters.after)
    }
    if (filters.has === "link") {
      dmQuery = dmQuery.ilike("content", "%http%")
    }
    if (filters.has === "image") {
      dmQuery = dmQuery.or(
        "content.ilike.%http%.png%,content.ilike.%http%.jpg%,content.ilike.%http%.jpeg%,content.ilike.%http%.gif%,content.ilike.%http%.webp%"
      )
    }
    if (filters.has === "file") {
      dmQuery = dmQuery.or(
        "content.ilike.%.pdf%,content.ilike.%.docx%,content.ilike.%.xlsx%,content.ilike.%.zip%,content.ilike.%.mp3%,content.ilike.%.mp4%"
      )
    }

    const { data: dmMessages, error: dmError } = await dmQuery

    if (dmError) {
      log.error({ route: "/api/search", action: "dmSearch", dmChannelId, userId: user.id, error: dmError.message }, "DM search query failed")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const blockedUserIds = await getBlockedUserIdsForViewer(supabase, user.id)
    const visibleDMs = filterBlockedUserIds(
      dmMessages ?? [],
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
      author: m.sender,
    }))

    return NextResponse.json({ results, total: results.length }, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" },
    })
  } catch (err) {
    log.error({ route: "/api/search", action: "GET", error: err }, "GET error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
