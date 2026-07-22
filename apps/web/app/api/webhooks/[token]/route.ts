import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/webhooks/[token]
 *
 * Incoming webhook endpoint. Accepts JSON body compatible with Discord webhook format:
 *   { content?: string, username?: string, avatar_url?: string, embeds?: Array<{ title, description, color }> }
 *
 * The webhook token maps to a specific channel in a specific server.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Coarse IP-level rate limit — 60 webhook calls per minute per IP
    // failClosed: webhook endpoints must not allow unlimited traffic when Redis is down
    const ip = getClientIp(req.headers) ?? "unknown"
    const ipRl = await rateLimiter.check(`webhook_ip:${ip}`, { limit: 60, windowMs: 60_000, failClosed: true })
    if (!ipRl.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 })
    }

    // Rate limit per webhook token — 30 messages per minute
    // failClosed: prevent unlimited message flooding when Redis is down
    const rl = await rateLimiter.check(`webhook:${token}`, { limit: 30, windowMs: 60_000, failClosed: true })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Resolve webhook by token
    const { data: webhook, error: whError } = await supabaseAdmin
      .from("webhooks")
      .select("id, channel_id, server_id, name, avatar_url")
      .eq("token", token)
      .maybeSingle()

    if (whError) {
      console.error("[webhook POST] DB error resolving webhook:", whError.message)
      return NextResponse.json({ error: "internal server error" }, { status: 500 })
    }
    if (!webhook) {
      return NextResponse.json({ error: "Unknown webhook" }, { status: 404 })
    }

    // Read raw body for HMAC verification and JSON parsing
    let rawBody: string
    try {
      rawBody = await req.text()
    } catch {
      return NextResponse.json({ error: "Failed to read request body" }, { status: 400 })
    }

    // HMAC signature verification — mandatory on all webhook requests.
    // Verify X-Webhook-Signature against the request body using the webhook
    // token as the HMAC-SHA256 key.
    const signatureHeader = req.headers.get("x-webhook-signature")
    if (!signatureHeader) {
      return NextResponse.json({ error: "Missing X-Webhook-Signature header" }, { status: 401 })
    }
    const expectedSig = crypto
      .createHmac("sha256", token)
      .update(rawBody)
      .digest("hex")
    const sigBuffer = Buffer.from(signatureHeader)
    const expectedBuffer = Buffer.from(expectedSig)
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    let body: unknown

    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { content, username, avatar_url, embeds } = body as {
      content?: unknown
      username?: unknown
      avatar_url?: unknown
      embeds?: unknown
    }

    // Runtime type validation
    if (content !== undefined && typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 })
    }
    if (username !== undefined && typeof username !== "string") {
      return NextResponse.json({ error: "username must be a string" }, { status: 400 })
    }
    if (avatar_url !== undefined && typeof avatar_url !== "string") {
      return NextResponse.json({ error: "avatar_url must be a string" }, { status: 400 })
    }
    if (embeds !== undefined && !Array.isArray(embeds)) {
      return NextResponse.json({ error: "embeds must be an array" }, { status: 400 })
    }

    if (!content && (!embeds || embeds.length === 0)) {
      return NextResponse.json({ error: "content or embeds required" }, { status: 400 })
    }

    // Build message content — concatenate embed descriptions if no content
    let messageContent = content?.slice(0, 2000) ?? ""
    if (!messageContent && embeds?.length) {
      const e = embeds[0]
      if (typeof e === "object" && e !== null) {
        const parts: string[] = []
        if (typeof e.title === "string") parts.push(`**${e.title}**`)
        if (typeof e.description === "string") parts.push(e.description)
        messageContent = parts.join("\n").slice(0, 2000)
      }
    }

    // The webhook display name and avatar override come from the request (like Discord)
    const displayName = username?.slice(0, 80) ?? webhook.name ?? "Webhook"
    const candidateAvatarUrl = avatar_url ?? webhook.avatar_url ?? null
    let webhookAvatarUrl: string | null = null
    if (candidateAvatarUrl) {
      try {
        const parsed = new URL(candidateAvatarUrl)
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && candidateAvatarUrl.length <= 2048) {
          webhookAvatarUrl = parsed.toString()
        }
      } catch {
        // Invalid URL — fall through to null
      }
    }

    // Insert the message attributed to the system bot with webhook_id set.
    // Display metadata is stored in dedicated columns so content stays clean
    // for reply previews, search, and clipboard operations.
    const { data: message, error: msgError } = await supabaseAdmin
      .from("messages")
      .insert({
        channel_id: webhook.channel_id,
        author_id: SYSTEM_BOT_ID,
        webhook_id: webhook.id,
        webhook_display_name: displayName,
        webhook_avatar_url: webhookAvatarUrl,
        content: messageContent,
      })
      .select("id")
      .single()

    if (msgError || !message) {
      console.error("Webhook message insert failed:", msgError?.message)
      return NextResponse.json({ error: "internal server error" }, { status: 500 })
    }

    return NextResponse.json({ id: message.id }, { status: 200 })
  } catch (err) {
    console.error("Webhook handler error:", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "internal server error" }, { status: 500 })
  }
}

// GET — return webhook info (used by management UI to verify token)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { token } = await params

    const { data: webhook, error } = await supabaseAdmin
      .from("webhooks")
      .select("id, name, avatar_url, channel_id, server_id")
      .eq("token", token)
      .maybeSingle()

    if (error) {
      console.error("[webhook GET] DB error:", error.message)
      return NextResponse.json({ error: "internal server error" }, { status: 500 })
    }
    if (!webhook) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 })
    return NextResponse.json({ id: webhook.id, name: webhook.name, channel_id: webhook.channel_id })
  } catch (err) {
    console.error("[webhook GET]", err instanceof Error ? err.message : "Unknown error")
    return NextResponse.json({ error: "internal server error" }, { status: 500 })
  }
}
