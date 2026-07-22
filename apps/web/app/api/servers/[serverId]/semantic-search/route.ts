import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { resolveAdapter } from "@/lib/ai/ai-router"

type Params = { params: Promise<{ serverId: string }> }

/**
 * POST /api/servers/[serverId]/semantic-search
 *
 * AI-powered semantic search across server message history.
 * Fetches recent messages, uses AI to rank by relevance to the query.
 * Uses the server's configured AI provider for `semantic_search`.
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerPermission(serverId, "VIEW_CHANNELS")
    if (error) return error

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const data = body as Record<string, unknown>
    const query = data.query
    if (typeof query !== "string" || query.trim() === "") {
      return NextResponse.json({ error: "query is required" }, { status: 400 })
    }

    // Optional filters
    const channelId = typeof data.channelId === "string" ? data.channelId : undefined
    const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId : undefined

    // Fetch a broad set of recent messages to search through
    let msgQuery = supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        channel_id,
        author:users!author_id(id, username, display_name, avatar_url),
        channels!channel_id(name)
      `)
      .eq("channels.server_id", serverId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200)

    if (channelId) {
      msgQuery = msgQuery.eq("channel_id", channelId)
    }
    if (fromUserId) {
      msgQuery = msgQuery.eq("author_id", fromUserId)
    }

    const { data: messages, error: msgError } = await msgQuery

    if (msgError) {
      console.error("[semantic-search] message query failed", { serverId, error: msgError.message })
      return NextResponse.json({ error: "Failed to search messages" }, { status: 500 })
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ results: [] })
    }

    // Filter to messages that have content
    const withContent = messages.filter((m: Record<string, unknown>) => m.content && (m.content as string).trim().length > 0)
    if (withContent.length === 0) {
      return NextResponse.json({ results: [] })
    }

    const adapter = await resolveAdapter(supabase, serverId, "semantic_search")
    if (!adapter) {
      return NextResponse.json(
        { error: "Semantic search is not configured. The server owner must add an AI provider." },
        { status: 503 }
      )
    }

    // Build indexed message list for the AI
    const indexedMessages = withContent.slice(0, 100).map((m: Record<string, unknown>, i: number) => {
      const author = Array.isArray(m.author) ? m.author[0] : m.author
      const name = (author as { display_name?: string; username?: string } | null)?.display_name
        || (author as { username?: string } | null)?.username
        || "Unknown"
      return `[${i}] ${name}: ${m.content}`
    })

    const result = await adapter.complete(
      [
        {
          role: "system",
          content: `You are a semantic search engine for a chat application.
Given a user's search query and a list of messages, return the indices of the most relevant messages ranked by semantic relevance.
Return JSON: { "matches": [{"index": 0, "relevance": 4}, {"index": 5, "relevance": 3}] }
relevance is 1-4 (4 = highly relevant, 1 = tangentially related).
Return at most 10 results. Only include messages that are genuinely relevant to the query.
If nothing is relevant, return { "matches": [] }.`,
        },
        {
          role: "user",
          content: `Search query: "${query.trim()}"\n\nMessages:\n${indexedMessages.join("\n")}`,
        },
      ],
      { maxTokens: 256, temperature: 0.2, jsonMode: true }
    )

    let parsed: { matches: Array<{ index: number; relevance: number }> }
    try {
      parsed = JSON.parse(result.text)
    } catch {
      parsed = { matches: [] }
    }

    const searchMessages = withContent.slice(0, 100)
    const results = (parsed.matches ?? [])
      .filter((m) => typeof m.index === "number" && m.index >= 0 && m.index < searchMessages.length)
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, 10)
      .map((match) => {
        const msg = searchMessages[match.index]
        const author = Array.isArray(msg.author) ? msg.author[0] : msg.author
        const channel = Array.isArray(msg.channels) ? msg.channels[0] : msg.channels
        return {
          id: msg.id,
          content: msg.content,
          channelId: msg.channel_id,
          channelName: (channel as { name?: string } | null)?.name ?? null,
          createdAt: msg.created_at,
          author: {
            id: (author as { id?: string } | null)?.id ?? null,
            username: (author as { username?: string } | null)?.username ?? "Unknown",
            displayName: (author as { display_name?: string } | null)?.display_name ?? null,
            avatarUrl: (author as { avatar_url?: string } | null)?.avatar_url ?? null,
          },
          relevance: match.relevance,
        }
      })

    return NextResponse.json({ results })
  } catch (err) {
    console.error("[semantic-search] error:", err)
    return NextResponse.json({ error: "Semantic search failed" }, { status: 500 })
  }
}
