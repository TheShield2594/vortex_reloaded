import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { resolveAdapter } from "@/lib/ai/ai-router"

type Params = { params: Promise<{ serverId: string; channelId: string; messageId: string }> }

/**
 * POST /api/servers/[serverId]/channels/[channelId]/messages/[messageId]/translate
 *
 * Translate a single message into the requested target language.
 * Uses the server's configured AI provider for the `translation` function.
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId, channelId, messageId } = await params
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

    const targetLanguage = (body as Record<string, unknown>).targetLanguage
    if (typeof targetLanguage !== "string" || targetLanguage.trim() === "") {
      return NextResponse.json({ error: "targetLanguage is required" }, { status: 400 })
    }

    // Fetch the message content
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .select("id, content, channel_id")
      .eq("id", messageId)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .maybeSingle()

    if (msgError) {
      console.error("[translate] message query failed", { messageId, error: msgError.message })
      return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 })
    }

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    if (!message.content || message.content.trim() === "") {
      return NextResponse.json({ error: "Message has no text content to translate" }, { status: 400 })
    }

    const adapter = await resolveAdapter(supabase, serverId, "translation")
    if (!adapter) {
      return NextResponse.json(
        { error: "Translation is not configured. The server owner must add an AI provider in server settings." },
        { status: 503 }
      )
    }

    const result = await adapter.complete(
      [
        {
          role: "system",
          content: `You are a translator. Translate the following chat message into ${targetLanguage.trim()}. Return ONLY the translated text with no explanation, no quotes, no prefixes. Preserve the original formatting (markdown, emoji, etc).`,
        },
        {
          role: "user",
          content: message.content,
        },
      ],
      { maxTokens: 512, temperature: 0.3 }
    )

    return NextResponse.json({
      translatedText: result.text.trim(),
      targetLanguage: targetLanguage.trim(),
      sourceMessageId: messageId,
    })
  } catch (err) {
    console.error("[translate] error:", err)
    return NextResponse.json({ error: "Translation failed" }, { status: 500 })
  }
}
