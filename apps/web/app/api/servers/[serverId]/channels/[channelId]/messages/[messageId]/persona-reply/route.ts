import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission, SYSTEM_BOT_ID } from "@/lib/server-auth"
import { resolveAdapter } from "@/lib/ai/ai-router"
import type { AiProviderAdapter } from "@/lib/ai/providers"
import type { AiProvider } from "@vortex/shared"

type Params = { params: Promise<{ serverId: string; channelId: string; messageId: string }> }

/**
 * POST /api/servers/[serverId]/channels/[channelId]/messages/[messageId]/persona-reply
 *
 * Generate an AI persona reply to a message. The persona's response is inserted
 * as a new message from the system bot with persona metadata.
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId, channelId, messageId } = await params
    const { supabase, user, error } = await requireServerPermission(serverId, "SEND_MESSAGES")
    if (error) return error
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
    const personaId = data.personaId
    if (typeof personaId !== "string") {
      return NextResponse.json({ error: "personaId is required" }, { status: 400 })
    }

    // Validate channel belongs to this server
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, server_id")
      .eq("id", channelId)
      .eq("server_id", serverId)
      .maybeSingle()

    if (channelError) {
      console.error("[persona-reply] channel lookup failed", { channelId, error: channelError.message })
      return NextResponse.json({ error: "Failed to verify channel" }, { status: 500 })
    }

    if (!channel) {
      return NextResponse.json({ error: "Channel not found in this server" }, { status: 404 })
    }

    // Validate messageId exists in this channel
    const { data: triggerMessage, error: triggerError } = await supabase
      .from("messages")
      .select("id, created_at")
      .eq("id", messageId)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .maybeSingle()

    if (triggerError) {
      console.error("[persona-reply] message lookup failed", { messageId, error: triggerError.message })
      return NextResponse.json({ error: "Failed to verify message" }, { status: 500 })
    }

    if (!triggerMessage) {
      return NextResponse.json({ error: "Message not found in this channel" }, { status: 404 })
    }

    // Fetch persona
    const { data: persona, error: personaError } = await supabase
      .from("ai_personas")
      .select("id, name, avatar_url, system_prompt, provider_config_id, allowed_channel_ids, is_active")
      .eq("id", personaId)
      .eq("server_id", serverId)
      .maybeSingle()

    if (personaError) {
      console.error("[persona-reply] persona query failed", { personaId, error: personaError.message })
      return NextResponse.json({ error: "Failed to fetch persona" }, { status: 500 })
    }

    if (!persona || !persona.is_active) {
      return NextResponse.json({ error: "Persona not found or inactive" }, { status: 404 })
    }

    // Check channel restriction
    const allowedChannels = persona.allowed_channel_ids as string[] | null
    if (allowedChannels && allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      return NextResponse.json({ error: "This persona is not available in this channel" }, { status: 403 })
    }

    // Fetch the triggering message + recent context (last 15 messages)
    const { data: contextMessages } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        author:users!author_id(username, display_name)
      `)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .lte("created_at", triggerMessage.created_at)
      .order("created_at", { ascending: false })
      .limit(15)

    const chronological = [...(contextMessages ?? [])].reverse()
    const transcript = chronological
      .map((m) => {
        const author = Array.isArray(m.author) ? m.author[0] : m.author
        const name = (author as { display_name?: string; username?: string } | null)?.display_name
          || (author as { username?: string } | null)?.username
          || "Unknown"
        return `${name}: ${m.content}`
      })
      .join("\n")

    // Resolve adapter — prefer persona-specific provider, fall back to server persona routing
    let adapter: AiProviderAdapter | null = null
    if (persona.provider_config_id) {
      const { createAdapter } = await import("@/lib/ai/providers")
      const { data: config } = await supabase
        .from("ai_provider_configs")
        .select("provider, api_key, base_url, model")
        .eq("id", persona.provider_config_id)
        .maybeSingle()
      if (config) {
        const { AI_PROVIDER_META } = await import("@vortex/shared")
        const provider = config.provider as AiProvider
        try {
          adapter = createAdapter({
            provider,
            apiKey: config.api_key,
            baseUrl: config.base_url,
            model: config.model ?? AI_PROVIDER_META[provider]?.defaultModel ?? provider,
          })
        } catch {
          // Fall through to default
        }
      }
    }

    if (!adapter) {
      adapter = await resolveAdapter(supabase, serverId, "persona")
    }

    if (!adapter) {
      return NextResponse.json(
        { error: "AI is not configured for personas. The server owner must add an AI provider." },
        { status: 503 }
      )
    }

    const result = await adapter.complete(
      [
        {
          role: "system",
          content: `${persona.system_prompt}\n\nYou are "${persona.name}", responding in a chat channel. Keep responses conversational and concise (1-3 short paragraphs max). Do not use markdown headers. Do not break character.`,
        },
        {
          role: "user",
          content: `Chat context:\n${transcript}\n\nRespond as ${persona.name}:`,
        },
      ],
      { maxTokens: 512, temperature: 0.7 }
    )

    // Insert the persona response as a system bot message.
    // Use webhook_display_name/webhook_avatar_url to carry persona identity
    // (these fields already exist on the messages table for bot-like messages).
    const personaReplyContent = result.text.trim()
    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        author_id: SYSTEM_BOT_ID,
        content: personaReplyContent,
        webhook_display_name: `${persona.name} [AI]`,
        webhook_avatar_url: persona.avatar_url,
      })
      .select("id, content, created_at")
      .single()

    if (insertError) {
      console.error("[persona-reply] insert failed", { error: insertError.message })
      return NextResponse.json({ error: "Failed to save persona reply" }, { status: 500 })
    }

    return NextResponse.json({
      message: {
        id: inserted.id,
        content: inserted.content,
        createdAt: inserted.created_at,
        personaName: persona.name,
        personaAvatarUrl: persona.avatar_url,
      },
    })
  } catch (err) {
    console.error("[persona-reply] error:", err)
    return NextResponse.json({ error: "Persona reply failed" }, { status: 500 })
  }
}
