import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { resolveAdapter } from "@/lib/ai/ai-router"

type Params = { params: Promise<{ serverId: string; channelId: string }> }

/**
 * POST /api/servers/[serverId]/channels/[channelId]/smart-replies
 *
 * Generate 2-3 contextual reply suggestions based on recent channel messages.
 * Uses the server's configured AI provider for the `smart_reply` function.
 */
export async function POST(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  let serverId = "unknown"
  let channelId = "unknown"
  try {
    const resolved = await params
    serverId = resolved.serverId
    channelId = resolved.channelId
    const { supabase, user, error } = await requireServerPermission(serverId, "SEND_MESSAGES")
    if (error) return error
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify channel belongs to this server
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, server_id")
      .eq("id", channelId)
      .eq("server_id", serverId)
      .maybeSingle()

    if (channelError) {
      console.error("[smart-replies] channel query failed", { serverId, channelId, error: channelError.message })
      return NextResponse.json({ error: "Failed to verify channel" }, { status: 500 })
    }

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Fetch recent messages for context (last 20)
    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        author:users!author_id(username, display_name)
      `)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20)

    if (msgError) {
      console.error("[smart-replies] message query failed", { channelId, error: msgError.message })
      return NextResponse.json({ error: "Failed to load messages" }, { status: 500 })
    }

    if (!messages || messages.length < 3) {
      return NextResponse.json({ suggestions: [] })
    }

    const chronological = [...messages].reverse()
    const transcript = chronological
      .map((m) => {
        const author = Array.isArray(m.author) ? m.author[0] : m.author
        const name = (author as { display_name?: string; username?: string } | null)?.display_name
          || (author as { username?: string } | null)?.username
          || "Unknown"
        return `${name}: ${m.content}`
      })
      .join("\n")

    const adapter = await resolveAdapter(supabase, serverId, "smart_reply")
    if (!adapter) {
      return NextResponse.json({ suggestions: [] })
    }

    // Get current user's display name for context
    const { data: profile } = await supabase
      .from("users")
      .select("display_name, username")
      .eq("id", user.id)
      .maybeSingle()

    const userName = profile?.display_name || profile?.username || "User"

    let result
    try {
      result = await adapter.complete(
        [
          {
            role: "system",
            content: `You generate short, natural reply suggestions for a chat app user named "${userName}".
Given a conversation, suggest 2-3 brief replies the user might send next.
Return JSON: { "suggestions": ["reply1", "reply2", "reply3"] }
Rules:
- Each reply must be 1-12 words max
- Sound natural and conversational, not robotic
- Match the tone of the conversation (casual, professional, etc.)
- Include at most one emoji-only reply
- Don't repeat what was already said`,
          },
          {
            role: "user",
            content: `Recent conversation:\n${transcript}\n\nSuggest replies for ${userName}:`,
          },
        ],
        { maxTokens: 128, temperature: 0.8, jsonMode: true }
      )
    } catch (aiErr: unknown) {
      const errorName = aiErr instanceof Error ? aiErr.name : "UnknownError"
      console.error("[smart-replies] AI provider error", {
        route: "POST /api/servers/[serverId]/channels/[channelId]/smart-replies",
        userId: user.id,
        action: "generate_smart_replies",
        serverId,
        channelId,
        errorName,
      })
      return NextResponse.json({ suggestions: [] })
    }

    let parsed: { suggestions: string[] }
    try {
      parsed = JSON.parse(result.text)
    } catch {
      parsed = { suggestions: [] }
    }

    // Sanitize: trim, limit to 3, filter empty
    const suggestions = (parsed.suggestions ?? [])
      .map((s: string) => (typeof s === "string" ? s.trim() : ""))
      .filter((s: string) => s.length > 0)
      .slice(0, 3)

    return NextResponse.json({ suggestions })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "unknown"
    console.error("[smart-replies] error:", { error: errMsg, serverId, channelId })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
