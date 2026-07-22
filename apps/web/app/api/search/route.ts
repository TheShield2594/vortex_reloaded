import { NextRequest, NextResponse } from "next/server"
import { getBatchChannelPermissions, hasPermission } from "@/lib/permissions"
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

// Unified search across messages + tasks + docs + DMs
export async function GET(req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Rate limit: 10 searches per minute per user
    const rl = await rateLimiter.check(`search:${user.id}`, { limit: 10, windowMs: 60_000 })
    if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 })

    const { searchParams } = new URL(req.url)
    const rawQuery = searchParams.get("q")?.trim() ?? ""
    const serverId = searchParams.get("serverId")
    const channelId = searchParams.get("channelId")
    const dmChannelId = searchParams.get("dmChannelId")
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "25", 10), 100)

    if (!rawQuery) return NextResponse.json({ error: "q required" }, { status: 400 })
    if (rawQuery.length > 500) return NextResponse.json({ error: "Query too long (max 500 chars)" }, { status: 400 })
    if (!serverId && !channelId && !dmChannelId) {
      return NextResponse.json({ error: "serverId, channelId, or dmChannelId required" }, { status: 400 })
    }

    const { query, filters } = parseSearchQuery(rawQuery)

    // ─── DM search path ──────────────────────────────────────────────────
    if (dmChannelId) {
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
    }

    // ─── Server / channel search path ────────────────────────────────────
    if (serverId) {
      const { data: member } = await supabase.from("server_members").select("user_id").eq("server_id", serverId as string).eq("user_id", user.id).single()
      if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let scopedChannels: Array<{ id: string; server_id: string | null }> = []
    if (channelId) {
      const { data: requestedChannel } = await supabase
        .from("channels")
        .select("id, server_id")
        .eq("id", channelId)
        .maybeSingle()

      if (!requestedChannel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })
      if (serverId && requestedChannel.server_id !== serverId) {
        return NextResponse.json({ error: "Channel does not belong to server" }, { status: 400 })
      }

      scopedChannels = [requestedChannel]
    } else {
      const { data: channels } = await supabase
        .from("channels")
        .select("id, server_id")
        .eq("server_id", serverId as string)
        .in("type", ["text", "announcement", "forum", "media"])
      scopedChannels = channels ?? []
    }

    // Batch permission check: 3 queries total instead of N × 7 per channel (#653)
    const channelsByServer = new Map<string, string[]>()
    for (const channel of scopedChannels) {
      if (!channel.server_id) continue
      let list = channelsByServer.get(channel.server_id)
      if (!list) {
        list = []
        channelsByServer.set(channel.server_id, list)
      }
      list.push(channel.id)
    }

    const channelIds: string[] = []
    for (const [sid, cids] of channelsByServer) {
      const permsMap = await getBatchChannelPermissions(supabase, sid, cids, user.id)
      for (const [channelId, perms] of permsMap) {
        if (perms.isAdmin || hasPermission(perms.permissions, "VIEW_CHANNELS")) {
          channelIds.push(channelId)
        }
      }
    }

    if (channelIds.length === 0) return NextResponse.json({ results: [], total: 0 })

    let attachmentBackedImageMessageIds: string[] = []
    let attachmentBackedFileMessageIds: string[] = []

    if (filters.has === "image" || filters.has === "file") {
      const { data: candidateMessages } = await supabase
        .from("messages")
        .select("id")
        .in("channel_id", channelIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10000)

      const candidateMessageIds = (candidateMessages ?? []).map((row) => row.id)

      const { data: attachmentRows } = candidateMessageIds.length === 0
        ? { data: [] as Array<{ message_id: string; content_type: string | null; filename: string }> }
        : await supabase
          .from("attachments")
          .select("message_id, content_type, filename")
          .in("message_id", candidateMessageIds)

      const rows = attachmentRows ?? []
      attachmentBackedImageMessageIds = Array.from(new Set(
        rows
          .filter((row) => row.content_type?.toLowerCase().startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(row.filename ?? ""))
          .map((row) => row.message_id)
      ))
      attachmentBackedFileMessageIds = Array.from(new Set(rows.map((row) => row.message_id)))
    }

    let messageQuery = supabase.from("messages").select("id, content, channel_id, created_at, author_id, author:users!messages_author_id_fkey(id, username, display_name, avatar_url)")
      .in("channel_id", channelIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (query) {
      messageQuery = messageQuery.textSearch("search_vector", query, { type: "websearch", config: "english" })
    }
    if (filters.fromUserId) {
      messageQuery = messageQuery.eq("author_id", filters.fromUserId)
    }
    if (filters.before) {
      messageQuery = messageQuery.lt("created_at", filters.before)
    }
    if (filters.after) {
      messageQuery = messageQuery.gt("created_at", filters.after)
    }
    if (filters.has === "link") {
      messageQuery = messageQuery.ilike("content", "%http%")
    }
    if (filters.has === "image") {
      const contentImageFilter = "content.ilike.%http%.png%,content.ilike.%http%.jpg%,content.ilike.%http%.jpeg%,content.ilike.%http%.gif%,content.ilike.%http%.webp%"
      if (attachmentBackedImageMessageIds.length > 0) {
        messageQuery = messageQuery.or(`${contentImageFilter},id.in.(${attachmentBackedImageMessageIds.join(",")})`)
      } else {
        messageQuery = messageQuery.or(contentImageFilter)
      }
    }
    if (filters.has === "file") {
      if (attachmentBackedFileMessageIds.length > 0) {
        messageQuery = messageQuery.in("id", attachmentBackedFileMessageIds)
      } else {
        messageQuery = messageQuery.eq("id", "00000000-0000-0000-0000-000000000000")
      }
    }

    const [{ data: messages }, { data: tasks }, { data: docs }] = await Promise.all([
      messageQuery,
      supabase.from("channel_tasks").select("id, title, description, status, due_date, channel_id, created_at")
        .in("channel_id", channelIds)
        .textSearch("search_vector", query || rawQuery, { type: "websearch", config: "english" })
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase.from("channel_docs").select("id, title, content, channel_id, updated_at")
        .in("channel_id", channelIds)
        .textSearch("search_vector", query || rawQuery, { type: "websearch", config: "english" })
        .order("updated_at", { ascending: false })
        .limit(limit),
    ])

    const blockedUserIds = await getBlockedUserIdsForViewer(supabase, user.id)
    const visibleMessages = filterBlockedUserIds(messages ?? [], (message) => message.author_id, blockedUserIds)

    const results = [
      ...visibleMessages.map((m) => ({ type: "message", ...m })),
      ...(tasks ?? []).map((t) => ({ type: "task", ...t })),
      ...(docs ?? []).map((d) => ({ type: "doc", ...d })),
    ]

    return NextResponse.json({ results, total: results.length }, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" },
    })

  } catch (err) {
    log.error({ route: "/api/search", action: "GET", error: err }, "GET error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
