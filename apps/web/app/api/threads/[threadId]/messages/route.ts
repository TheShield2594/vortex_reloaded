import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { rateLimiter } from "@/lib/rate-limit"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"
import { validateAttachments } from "@/lib/attachment-validation"
import { sendPushToChannel } from "@/lib/push"
import type { Database } from "@/types/database"

interface Params {
  params: Promise<{ threadId: string }>
}

// GET /api/threads/[threadId]/messages?before=<timestamp>&limit=50
export async function GET(request: Request, { params: paramsPromise }: Params) {
  const { threadId } = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const before = searchParams.get("before")
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)

  const { data: thread, error: threadError } = await supabase
    .from("threads")
    .select("id, parent_channel_id, channels(server_id)")
    .eq("id", threadId)
    .single()

  if (threadError || !thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  const serverId = (thread.channels as { server_id?: string | null } | null)?.server_id ?? null
  if (serverId) {
    const { isAdmin, permissions } = await getChannelPermissions(supabase, serverId, thread.parent_channel_id, user.id)
    if (!isAdmin && !hasPermission(permissions, "VIEW_CHANNELS")) {
      return NextResponse.json({ error: "Missing VIEW_CHANNELS permission" }, { status: 403 })
    }
  }

  let query = supabase
    .from("messages")
    .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
    .eq("thread_id", threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt("created_at", before)
  }

  const { data: messages, error } = await query
  if (error) return NextResponse.json({ error: "Failed to fetch thread messages" }, { status: 500 })

  // Mark thread as read for this user
  try { await supabase.rpc("mark_thread_read", { p_thread_id: threadId }) } catch {}

  return NextResponse.json((messages ?? []).reverse())
}

// POST /api/threads/[threadId]/messages  { content, replyToId?, attachments? }
export async function POST(request: Request, { params: paramsPromise }: Params) {
  const { threadId } = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Rate limit
  const rl = await rateLimiter.check(`thread_msg:${user.id}`, { limit: 5, windowMs: 10_000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You are sending messages too fast. Slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    )
  }

  let body: {
    content?: string
    replyToId?: string
    attachments?: Array<{
      url: string
      filename: string
      size: number
      content_type: string
      width?: number
      height?: number
    }>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { content, replyToId, attachments: rawAttachments } = body
  const attachments = rawAttachments ?? []

  if (!Array.isArray(attachments)) return NextResponse.json({ error: "Invalid attachments" }, { status: 400 })
  if (!attachments.every((attachment) => {
    if (!attachment || typeof attachment !== "object") return false
    const candidate = attachment as Record<string, unknown>
    return (
      typeof candidate.url === "string"
      && typeof candidate.filename === "string"
      && typeof candidate.size === "number"
      && typeof candidate.content_type === "string"
    )
  })) {
    return NextResponse.json({ error: "Invalid attachment elements" }, { status: 400 })
  }
  if (!content?.trim() && attachments.length === 0) {
    return NextResponse.json({ error: "Message must have content or attachments" }, { status: 400 })
  }

  const attachmentValidation = validateAttachments(attachments)
  if (!attachmentValidation.valid) {
    return NextResponse.json({ error: attachmentValidation.error }, { status: 400 })
  }

  // Fetch thread to get the channel_id and check locked/archived
  const { data: thread } = await supabase
    .from("threads")
    .select("id, parent_channel_id, locked, archived, channels(server_id)")
    .eq("id", threadId)
    .single()

  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })
  if (thread.locked) return NextResponse.json({ error: "Thread is locked" }, { status: 403 })

  const serverId = (thread.channels as { server_id?: string | null } | null)?.server_id ?? null
  if (serverId) {
    const { isAdmin, permissions } = await getChannelPermissions(supabase, serverId, thread.parent_channel_id, user.id)
    if (!isAdmin && !hasPermission(permissions, "SEND_MESSAGES")) {
      return NextResponse.json({ error: "Missing SEND_MESSAGES permission" }, { status: 403 })
    }
  }

  // Discord-style auto-unarchive: sending a message to an archived (non-locked)
  // thread automatically unarchives it and resets the inactivity timer.
  // This runs after the permission check so unauthorized users cannot unarchive threads.
  let didUnarchive = false
  if (thread.archived && !thread.locked) {
    const { error: unarchiveError } = await supabase
      .from("threads")
      .update({ archived: false, archived_at: null })
      .eq("id", threadId)
    if (unarchiveError) {
      return NextResponse.json({ error: "Failed to unarchive thread" }, { status: 500 })
    }
    didUnarchive = true
  }

  // Insert message linked to thread (channel_id = parent_channel_id for permissions)
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      channel_id: thread.parent_channel_id,
      thread_id: threadId,
      author_id: user.id,
      content: content?.trim() || null,
      reply_to_id: replyToId || null,
    })
    .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
    .single()

  if (msgError) {
    console.error("[threads/[threadId]/messages POST] insert error:", msgError.message)
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }

  // Insert attachments
  if (attachments.length > 0 && message) {
    const { data: insertedAttachments } = await supabase
      .from("attachments")
      .insert(attachments.map((a) => ({ ...a, message_id: message.id })))
      .select("id, filename, content_type, message_id")
  }

  // Auto-join the author as thread member if not already a member (ignore duplicate key)
  try {
    await supabase.from("thread_members").insert({ thread_id: threadId, user_id: user.id })
  } catch {}

  const sentMessage = message as Database["public"]["Tables"]["messages"]["Row"] & {
    author?: Database["public"]["Tables"]["users"]["Row"] | null
  }
  const senderName = sentMessage.author?.display_name || sentMessage.author?.username || "Someone"
  const senderAvatarUrl = sentMessage.author?.avatar_url ?? null
  const trimmedContent = content?.trim()
  sendPushToChannel({
    serverId: serverId ?? undefined,
    channelId: thread.parent_channel_id,
    threadId,
    senderName,
    senderAvatarUrl,
    content: trimmedContent ? trimmedContent : "Sent an attachment",
    excludeUserId: user.id,
  }).catch((error) => {
    console.warn("push delivery failed", { threadId, messageId: message.id, error })
  })

  return NextResponse.json(
    { ...message, _thread_unarchived: didUnarchive },
    { status: 201 }
  )
}
