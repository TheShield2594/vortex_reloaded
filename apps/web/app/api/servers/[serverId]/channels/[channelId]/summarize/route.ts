import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { resolveAdapter } from "@/lib/ai/ai-router"

type Params = { params: Promise<{ serverId: string; channelId: string }> }

/**
 * POST /api/servers/[serverId]/channels/[channelId]/summarize
 *
 * AI-powered channel catch-up summary.
 * Fetches recent messages and summarises them via the server's configured
 * AI provider for the `chat_summary` function.
 * Requires VIEW_CHANNELS permission.
 */
export async function POST(req: NextRequest, { params }: Params) {
  let serverId = "unknown"
  let channelId = "unknown"
  try {
    const resolved = await params
    serverId = resolved.serverId
    channelId = resolved.channelId
    const { supabase, error } = await requireServerPermission(serverId, "VIEW_CHANNELS")
    if (error) return error

    // Optional: since=ISO timestamp passed by client (user's last read time)
    let since: string | null = null
    try {
      const body = await req.json().catch(() => ({}))
      if (typeof body.since === "string") since = body.since
    } catch {
      // ignore parse errors
    }

    // Verify channel belongs to this server
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, name, server_id")
      .eq("id", channelId)
      .eq("server_id", serverId)
      .single()

    if (channelError) {
      console.error("[summarize] channel query failed", { serverId, channelId, error: channelError.message })
      return NextResponse.json({ error: "Failed to verify channel" }, { status: 500 })
    }

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Fetch recent messages (up to 150, or since last read)
    let query = supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        author:users!author_id(username, display_name),
        deleted_at
      `)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(150)

    if (since) {
      query = query.gte("created_at", since)
    }

    const { data: messages, error: msgError } = await query

    if (msgError) {
      return NextResponse.json({ error: "Failed to load messages" }, { status: 500 })
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({
        summary: "No new messages to summarize.",
        highlights: [],
        topics: [],
        messageCount: 0,
        since: since ?? null,
      })
    }

    // Reverse so they're chronological for the prompt
    const chronological = [...messages].reverse()

    const transcript = chronological
      .map((m) => {
        const author = Array.isArray(m.author) ? m.author[0] : m.author
        const name = (author as { display_name?: string; username?: string } | null)?.display_name
          || (author as { username?: string } | null)?.username
          || "Unknown"
        return `[${name}]: ${m.content}`
      })
      .join("\n")

    // Resolve the AI provider for chat_summary (uses per-function routing → default → legacy Gemini)
    const adapter = await resolveAdapter(supabase, serverId, "chat_summary")
    if (!adapter) {
      return NextResponse.json(
        { error: "AI summarization is not configured. The server owner must add an AI provider in server settings." },
        { status: 503 }
      )
    }

    let result
    try {
      result = await adapter.complete(
        [
          {
            role: "system",
            content: `You are a helpful assistant that summarizes chat channel conversations.
Return your response as JSON with this exact shape:
{
  "summary": "2-4 sentence overview of what was discussed",
  "highlights": ["key point 1", "key point 2", "key point 3"],
  "topics": ["topic1", "topic2"]
}
Be concise and factual. Only include information from the conversation.`,
          },
          {
            role: "user",
            content: `Summarize this conversation from the #${channel.name} channel (${chronological.length} messages):\n\n${transcript}`,
          },
        ],
        { maxTokens: 512, jsonMode: true }
      )
    } catch (aiErr: unknown) {
      console.error("[summarize] AI provider error", {
        serverId,
        channelId,
        error: aiErr instanceof Error ? aiErr.message : "Unknown AI error",
      })
      return NextResponse.json({ error: "AI summarization failed. Please try again later." }, { status: 502 })
    }

    let parsed: { summary: string; highlights: string[]; topics: string[] }
    try {
      parsed = JSON.parse(result.text)
    } catch {
      parsed = { summary: result.text, highlights: [], topics: [] }
    }

    return NextResponse.json({
      summary: parsed.summary ?? "",
      highlights: parsed.highlights ?? [],
      topics: parsed.topics ?? [],
      messageCount: chronological.length,
      since: since ?? chronological[0]?.created_at ?? null,
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "unknown"
    console.error("[summarize] error", { serverId, channelId, error: errMsg })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
