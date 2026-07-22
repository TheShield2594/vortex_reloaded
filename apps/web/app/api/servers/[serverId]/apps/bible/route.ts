import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"
import { untypedFrom } from "@/lib/supabase/untyped-table"

type Params = { params: Promise<{ serverId: string }> }

const DEFAULT_BIBLE_ID = "de4e12af7f28f599-02" // King James Version
const API_BIBLE_BASE = "https://rest.api.bible/v1"

/**
 * GET /api/servers/[serverId]/apps/bible
 * Returns Bible Bot config.
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

    const { data: config, error } = await untypedFrom(supabase, "bible_app_configs")
      .select("server_id, channel_id, bible_id, daily_verse_enabled, daily_verse_time, timezone, embed_color, enabled")
      .eq("server_id", serverId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: "Failed to fetch Bible Bot configuration" }, { status: 500 })

    return NextResponse.json({ config })
  } catch (err) {
    console.error("[servers/[serverId]/apps/bible GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * POST /api/servers/[serverId]/apps/bible
 * Actions: save_config, get_verse, post_daily_verse, list_bibles
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

  const action = body.action
  if (typeof action !== "string" || !action) {
    return NextResponse.json({ error: "Invalid or missing action" }, { status: 400 })
  }

  // ── Save config — requires MANAGE_CHANNELS ──
  if (action === "save_config") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const {
      channel_id,
      api_key,
      bible_id,
      daily_verse_enabled,
      daily_verse_time,
      timezone,
      embed_color,
      enabled,
    } = body as {
      channel_id?: string | null
      api_key?: string
      bible_id?: string
      daily_verse_enabled?: boolean
      daily_verse_time?: string
      timezone?: string
      embed_color?: string
      enabled?: boolean
    }

    if (channel_id) {
      const { data: ch } = await authSupabase
        .from("channels")
        .select("id")
        .eq("id", channel_id)
        .eq("server_id", serverId)
        .maybeSingle()
      if (!ch) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
    }

    // Validate api_key length
    if (api_key !== undefined && api_key.length > 512) {
      return NextResponse.json({ error: "API key is too long (max 512 characters)" }, { status: 400 })
    }

    // Validate embed_color format
    if (embed_color && !/^#[0-9A-Fa-f]{6}$/.test(embed_color)) {
      return NextResponse.json({ error: "Embed color must be a valid hex color (e.g. #C4A747)" }, { status: 400 })
    }

    // Validate time format HH:MM
    if (daily_verse_time && !/^\d{2}:\d{2}(:\d{2})?$/.test(daily_verse_time)) {
      return NextResponse.json({ error: "Daily verse time must be in HH:MM format" }, { status: 400 })
    }

    const upsertData: Record<string, unknown> = {
      server_id: serverId,
      ...(channel_id !== undefined && { channel_id }),
      ...(api_key !== undefined && { api_key }),
      ...(bible_id !== undefined && { bible_id }),
      ...(daily_verse_enabled !== undefined && { daily_verse_enabled }),
      ...(daily_verse_time !== undefined && { daily_verse_time: daily_verse_time.length === 5 ? `${daily_verse_time}:00` : daily_verse_time }),
      ...(timezone !== undefined && { timezone }),
      ...(embed_color !== undefined && { embed_color }),
      ...(enabled !== undefined && { enabled }),
    }

    const { data, error } = await untypedFrom(authSupabase, "bible_app_configs")
      .upsert(upsertData, { onConflict: "server_id" })
      .select("server_id, channel_id, bible_id, daily_verse_enabled, daily_verse_time, timezone, embed_color, enabled")
      .single()

    if (error) return NextResponse.json({ error: "Failed to save Bible Bot configuration" }, { status: 500 })
    return NextResponse.json(data)
  }

  // ── Get a specific verse ──
  if (action === "get_verse") {
    // Verify server membership
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const reference = (body.reference as string)?.trim()
    if (!reference || reference.length > 100) {
      return NextResponse.json({ error: "A Bible reference is required (e.g. 'John 3:16')" }, { status: 400 })
    }

    const { data: configData } = await untypedFrom(supabase, "bible_app_configs")
      .select("api_key, bible_id, enabled, channel_id, embed_color")
      .eq("server_id", serverId)
      .maybeSingle()

    if (configData && !configData.enabled) {
      return NextResponse.json({ error: "Bible Bot is disabled on this server" }, { status: 400 })
    }

    const apiKey = configData?.api_key
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured. Ask an admin to add one in Bible Bot settings." }, { status: 400 })
    }

    const bibleId = configData?.bible_id || DEFAULT_BIBLE_ID

    try {
      const searchRes = await fetch(
        `${API_BIBLE_BASE}/bibles/${bibleId}/search?query=${encodeURIComponent(reference)}&limit=1`,
        {
          headers: { "api-key": apiKey },
          signal: AbortSignal.timeout(10000),
        }
      )

      if (!searchRes.ok) {
        const status = searchRes.status
        if (status === 401 || status === 403) {
          return NextResponse.json({ error: "Invalid API key. Please check your Bible Bot configuration." }, { status: 400 })
        }
        return NextResponse.json({ error: "Failed to search for verse" }, { status: 502 })
      }

      const searchData = await searchRes.json() as { data?: { passages?: Array<{ reference?: string; content?: string }> } }
      const passage = searchData.data?.passages?.[0]

      if (!passage) {
        return NextResponse.json({ error: `No results found for "${reference}"` }, { status: 404 })
      }

      // Strip HTML from content
      const cleanContent = (passage.content || "").replace(/<[^>]+>/g, "").trim()
      const embedColor = configData?.embed_color || "#C4A747"

      const result = {
        reference: passage.reference || reference,
        content: cleanContent,
        embed_color: embedColor,
      }

      // If channel is configured, also post it (requires SEND_MESSAGES permission)
      const targetChannel = configData?.channel_id
      if (targetChannel) {
        const { error: sendPermError } = await requireServerPermission(serverId, "SEND_MESSAGES")
        if (!sendPermError) {
          const embedMsg = formatVerseEmbed(result.reference, result.content, embedColor)
          // Use service-role client to insert as system bot (bypasses RLS)
          const serviceClient = await createServiceRoleClient()
          const { error: insertError } = await serviceClient
            .from("messages")
            .insert({
              channel_id: targetChannel,
              author_id: SYSTEM_BOT_ID,
              content: embedMsg,
              webhook_display_name: "Bible Bot",
            })
          if (insertError) {
            console.error("[bible get_verse] failed to post verse to channel:", insertError)
            return NextResponse.json({ error: "Verse fetched but failed to post to channel" }, { status: 500 })
          }
        }
      }

      return NextResponse.json(result)
    } catch (err) {
      console.error("[bible get_verse] error:", err)
      return NextResponse.json({ error: "Failed to fetch verse from API" }, { status: 502 })
    }
  }

  // ── Post daily verse ──
  if (action === "post_daily_verse") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const { data: configData } = await untypedFrom(authSupabase, "bible_app_configs")
      .select("api_key, bible_id, enabled, channel_id, embed_color")
      .eq("server_id", serverId)
      .maybeSingle()

    if (configData && !configData.enabled) {
      return NextResponse.json({ error: "Bible Bot is disabled on this server" }, { status: 400 })
    }

    const apiKey = configData?.api_key
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 400 })
    }

    const targetChannel = configData?.channel_id
    if (!targetChannel) {
      return NextResponse.json({ error: "No channel configured" }, { status: 400 })
    }

    const bibleId = configData?.bible_id || DEFAULT_BIBLE_ID

    try {
      // Get verse of the day using a rotating popular verse list
      const verse = getDailyVerseReference()

      const searchRes = await fetch(
        `${API_BIBLE_BASE}/bibles/${bibleId}/search?query=${encodeURIComponent(verse)}&limit=1`,
        {
          headers: { "api-key": apiKey },
          signal: AbortSignal.timeout(10000),
        }
      )

      if (!searchRes.ok) {
        return NextResponse.json({ error: "Failed to fetch daily verse from API" }, { status: 502 })
      }

      const searchData = await searchRes.json() as { data?: { passages?: Array<{ reference?: string; content?: string }> } }
      const passage = searchData.data?.passages?.[0]

      if (!passage) {
        return NextResponse.json({ error: "No verse found" }, { status: 502 })
      }

      const cleanContent = (passage.content || "").replace(/<[^>]+>/g, "").trim()
      const embedColor = configData?.embed_color || "#C4A747"
      const embedMsg = formatVerseEmbed(passage.reference || verse, cleanContent, embedColor)

      // Use service-role client to insert as system bot (bypasses RLS)
      const serviceClient = await createServiceRoleClient()
      const { error: msgError } = await serviceClient
        .from("messages")
        .insert({
          channel_id: targetChannel,
          author_id: SYSTEM_BOT_ID,
          content: embedMsg,
          webhook_display_name: "Bible Bot",
        })

      if (msgError) return NextResponse.json({ error: "Failed to post daily verse" }, { status: 500 })

      return NextResponse.json({ ok: true, reference: passage.reference || verse })
    } catch (err) {
      console.error("[bible post_daily_verse] error:", err)
      return NextResponse.json({ error: "Failed to fetch daily verse" }, { status: 502 })
    }
  }

  // ── List available Bibles ──
  if (action === "list_bibles") {
    // Verify server membership
    const { data: bibleMembership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!bibleMembership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: configData } = await untypedFrom(supabase, "bible_app_configs")
      .select("api_key")
      .eq("server_id", serverId)
      .maybeSingle()

    const apiKey = configData?.api_key
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 400 })
    }

    try {
      const res = await fetch(`${API_BIBLE_BASE}/bibles?language=eng`, {
        headers: { "api-key": apiKey },
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        return NextResponse.json({ error: "Failed to fetch Bible list" }, { status: 502 })
      }

      const data = await res.json() as { data?: Array<{ id: string; name: string; abbreviation: string; language?: { name: string } }> }
      const bibles = (data.data ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        abbreviation: b.abbreviation,
        language: b.language?.name || "English",
      }))

      return NextResponse.json({ bibles })
    } catch (err) {
      console.error("[bible list_bibles] error:", err)
      return NextResponse.json({ error: "Failed to fetch Bible list" }, { status: 502 })
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[bible POST] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── Helpers ──

function formatVerseEmbed(reference: string, content: string, embedColor: string): string {
  return `[BIBLE_EMBED]\n${embedColor}\n${reference}\n${content}\n[/BIBLE_EMBED]`
}

/**
 * Returns a Bible verse reference for today based on a rotating list of popular verses.
 * Uses the day-of-year to cycle through the list.
 */
function getDailyVerseReference(): string {
  const verses = [
    "John 3:16", "Psalm 23:1-6", "Philippians 4:13", "Jeremiah 29:11",
    "Romans 8:28", "Proverbs 3:5-6", "Isaiah 40:31", "Psalm 46:1",
    "Matthew 11:28", "2 Timothy 1:7", "Romans 12:2", "Psalm 119:105",
    "1 Corinthians 13:4-7", "Galatians 5:22-23", "Joshua 1:9",
    "Psalm 37:4", "Hebrews 11:1", "Ephesians 2:8-9", "Psalm 27:1",
    "Matthew 6:33", "Romans 5:8", "Philippians 4:6-7", "Isaiah 41:10",
    "Psalm 34:8", "John 14:6", "Colossians 3:23", "Psalm 139:14",
    "Matthew 28:19-20", "1 Peter 5:7", "Psalm 91:1-2",
    "Deuteronomy 31:6", "James 1:5", "Micah 6:8", "Lamentations 3:22-23",
    "Proverbs 16:3", "Isaiah 26:3", "2 Corinthians 5:17",
  ]

  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  const diff = now.getTime() - start.getTime()
  const dayOfYear = Math.floor(diff / 86400000)

  return verses[dayOfYear % verses.length]
}
