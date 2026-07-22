import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"
import { untypedFrom } from "@/lib/supabase/untyped-table"

type Params = { params: Promise<{ serverId: string }> }

const MAX_FEEDS_PER_SERVER = 25
const MAX_URL_LENGTH = 2048

/**
 * GET /api/servers/[serverId]/apps/rss-feed
 * Returns RSS feed config + list of subscribed feeds.
 */
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify server membership
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const [configResult, feedsResult] = await Promise.all([
      untypedFrom(supabase, "rss_feed_app_configs")
        .select("*")
        .eq("server_id", serverId)
        .maybeSingle(),
      untypedFrom(supabase, "rss_feeds")
        .select("id, server_id, channel_id, feed_url, feed_title, last_fetched_at, created_by, created_at")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false }),
    ])

    if (configResult.error) return NextResponse.json({ error: "Failed to fetch RSS feed configuration" }, { status: 500 })

    return NextResponse.json({
      config: configResult.data,
      feeds: feedsResult.data ?? [],
    })
  } catch (err) {
    console.error("[servers/[serverId]/apps/rss-feed GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * POST /api/servers/[serverId]/apps/rss-feed
 * Actions: save_config, add_feed, remove_feed, fetch_feeds
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const action = body.action as string
  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 })
  }

  // ── Save config — requires MANAGE_CHANNELS ──
  if (action === "save_config") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const { channel_id, max_feeds, enabled } = body as {
      channel_id?: string | null
      max_feeds?: number
      enabled?: boolean
    }

    if (channel_id) {
      const { data: ch } = await authSupabase
        .from("channels")
        .select("id")
        .eq("id", channel_id)
        .eq("server_id", serverId)
        .single()
      if (!ch) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
    }

    const clampedMaxFeeds = Math.min(MAX_FEEDS_PER_SERVER, Math.max(1, max_feeds ?? 10))

    const upsertData = {
      server_id: serverId,
      ...(channel_id !== undefined && { channel_id }),
      max_feeds: clampedMaxFeeds,
      ...(enabled !== undefined && { enabled }),
    }

    const { data, error } = await untypedFrom(authSupabase, "rss_feed_app_configs")
      .upsert(upsertData, { onConflict: "server_id" })
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to save RSS feed configuration" }, { status: 500 })
    return NextResponse.json(data)
  }

  // ── Add feed — requires MANAGE_CHANNELS ──
  if (action === "add_feed") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const feedUrl = (body.feed_url as string)?.trim()
    const channelId = body.channel_id as string | undefined

    if (!feedUrl || feedUrl.length > MAX_URL_LENGTH) {
      return NextResponse.json({ error: "A valid feed URL is required (max 2048 characters)" }, { status: 400 })
    }

    // Basic URL validation
    try {
      const parsed = new URL(feedUrl)
      if (!parsed.protocol.startsWith("http")) {
        return NextResponse.json({ error: "Feed URL must use HTTP or HTTPS" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 })
    }

    // Check per-server feed limit
    const { data: configData } = await untypedFrom(authSupabase, "rss_feed_app_configs")
      .select("max_feeds, enabled, channel_id")
      .eq("server_id", serverId)
      .maybeSingle()

    if (configData && !configData.enabled) {
      return NextResponse.json({ error: "RSS Feed Bot is disabled on this server" }, { status: 400 })
    }

    const maxAllowed = configData?.max_feeds ?? 10

    const { count } = await untypedFrom(authSupabase, "rss_feeds")
      .select("id", { count: "exact", head: true })
      .eq("server_id", serverId)

    if ((count ?? 0) >= maxAllowed) {
      return NextResponse.json({ error: `Maximum ${maxAllowed} feeds allowed per server` }, { status: 400 })
    }

    // Check for duplicate URL
    const { data: existing } = await untypedFrom(authSupabase, "rss_feeds")
      .select("id")
      .eq("server_id", serverId)
      .eq("feed_url", feedUrl)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: "This feed URL is already added" }, { status: 400 })
    }

    const targetChannel = channelId || configData?.channel_id
    if (!targetChannel) {
      return NextResponse.json({ error: "No channel configured. Set a default channel or specify one." }, { status: 400 })
    }

    // Try to fetch the feed title
    let feedTitle: string | null = null
    try {
      const feedRes = await fetch(feedUrl, {
        headers: { "Accept": "application/rss+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(5000),
      })
      if (feedRes.ok) {
        const text = await feedRes.text()
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i)
        if (titleMatch?.[1]) {
          feedTitle = titleMatch[1].trim().substring(0, 256)
        }
      }
    } catch {
      // Non-fatal — we just won't have a title
    }

    const { data, error } = await untypedFrom(authSupabase, "rss_feeds")
      .insert({
        server_id: serverId,
        channel_id: targetChannel,
        feed_url: feedUrl,
        feed_title: feedTitle,
        created_by: user.id,
      })
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to add RSS feed" }, { status: 500 })
    return NextResponse.json(data)
  }

  // ── Remove feed — requires MANAGE_CHANNELS ──
  if (action === "remove_feed") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const feedId = body.feed_id as string
    if (!feedId) return NextResponse.json({ error: "feed_id is required" }, { status: 400 })

    const { error } = await untypedFrom(authSupabase, "rss_feeds")
      .delete()
      .eq("id", feedId)
      .eq("server_id", serverId)

    if (error) return NextResponse.json({ error: "Failed to remove feed" }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Fetch feeds — manually trigger a fetch of all feeds ──
  if (action === "fetch_feeds") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const { data: configData } = await untypedFrom(authSupabase, "rss_feed_app_configs")
      .select("enabled, channel_id")
      .eq("server_id", serverId)
      .maybeSingle()

    if (configData && !configData.enabled) {
      return NextResponse.json({ error: "RSS Feed Bot is disabled on this server" }, { status: 400 })
    }

    const { data: feeds } = await untypedFrom(authSupabase, "rss_feeds")
      .select("*")
      .eq("server_id", serverId)

    if (!feeds || feeds.length === 0) {
      return NextResponse.json({ error: "No feeds configured" }, { status: 400 })
    }

    let posted = 0

    for (const feed of feeds) {
      try {
        const feedRes = await fetch(feed.feed_url, {
          headers: { "Accept": "application/rss+xml, application/xml, text/xml" },
          signal: AbortSignal.timeout(10000),
        })
        if (!feedRes.ok) continue

        const text = await feedRes.text()
        const items = parseRssItems(text)

        if (items.length === 0) continue

        // Post the latest item as an embed-style message
        const latest = items[0]
        const targetChannel = feed.channel_id || configData?.channel_id
        if (!targetChannel) continue

        const embedContent = formatRssEmbed(latest, feed.feed_title || feed.feed_url)

        const { error: msgError } = await authSupabase
          .from("messages")
          .insert({
            channel_id: targetChannel,
            author_id: SYSTEM_BOT_ID,
            content: embedContent,
            webhook_display_name: "RSS Feed Bot",
          })

        if (msgError) {
          console.error(`[rss-feed fetch_feeds] Failed to post message for feed ${feed.id}:`, msgError)
        } else {
          posted++
        }

        // Update last fetched
        await untypedFrom(authSupabase, "rss_feeds")
          .update({
            last_fetched_at: new Date().toISOString(),
            ...(latest.id && { last_entry_id: latest.id }),
          })
          .eq("id", feed.id)
      } catch {
        // Non-fatal per feed
      }
    }

    return NextResponse.json({ ok: true, posted })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[servers/[serverId]/apps/rss-feed POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── Helpers ──

interface RssItem {
  title?: string
  link?: string
  description?: string
  pubDate?: string
  id?: string
  imageUrl?: string
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null = null

  while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
    const block = match[1]
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      description: extractTag(block, "description"),
      pubDate: extractTag(block, "pubDate"),
      id: extractTag(block, "guid") || extractTag(block, "link"),
      imageUrl: extractImageUrl(block),
    })
  }

  return items
}

const TAG_REGEXES: Record<string, RegExp> = {
  title: /<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([^<]*)<\/title>/i,
  link: /<link[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link[^>]*>([^<]*)<\/link>/i,
  description: /<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([^<]*)<\/description>/i,
  pubDate: /<pubDate[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/pubDate>|<pubDate[^>]*>([^<]*)<\/pubDate>/i,
  guid: /<guid[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/guid>|<guid[^>]*>([^<]*)<\/guid>/i,
}

function extractTag(xml: string, tag: string): string | undefined {
  const regex = TAG_REGEXES[tag]
  if (!regex) return undefined
  const m = xml.match(regex)
  return m?.[1]?.trim() || m?.[2]?.trim() || undefined
}

function extractImageUrl(xml: string): string | undefined {
  // Try <media:content url="...">
  const mediaMatch = xml.match(/<media:content[^>]+url=["']([^"']+)["']/i)
  if (mediaMatch?.[1]) return mediaMatch[1]
  // Try <enclosure url="..." type="image/..."> (either attribute order)
  const enclosureTag = xml.match(/<enclosure[^>]+>/i)?.[0]
  if (enclosureTag && /type=["']image\//i.test(enclosureTag)) {
    const urlMatch = enclosureTag.match(/url=["']([^"']+)["']/i)
    if (urlMatch?.[1]) return urlMatch[1]
  }
  // Try <media:thumbnail url="...">
  const thumbMatch = xml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
  if (thumbMatch?.[1]) return thumbMatch[1]
  // Try <image><url>...</url></image> — but only at item level, not channel level
  const imgUrlMatch = xml.match(/<image[^>]*>[\s\S]*?<url[^>]*>([^<]+)<\/url>/i)
  if (imgUrlMatch?.[1]) return imgUrlMatch[1].trim()
  // Try to find an <img> tag in description
  const imgTagMatch = xml.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (imgTagMatch?.[1]) return imgTagMatch[1]
  return undefined
}

function formatRssEmbed(item: RssItem, feedName: string): string {
  const title = (item.title ?? "").replace(/\n/g, " ").trim()
  const link = (item.link ?? "").replace(/\n/g, "").trim()
  const stripped = item.description
    ? item.description.replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim()
    : ""
  const description = stripped.substring(0, 300) + (stripped.length > 300 ? "..." : "")
  const pubDate = (item.pubDate ?? "").replace(/\n/g, " ").trim()
  const imageUrl = (item.imageUrl ?? "").replace(/\n/g, "").trim()
  const source = feedName.replace(/\n/g, " ").trim()

  return [
    "[RSS_EMBED]",
    source,
    title,
    description,
    link,
    pubDate,
    imageUrl,
    "[/RSS_EMBED]",
  ].join("\n")
}
