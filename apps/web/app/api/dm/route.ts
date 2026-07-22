import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { checkRateLimit } from "@/lib/utils/api-helpers"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/dm")

export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const partnerId = searchParams.get("partnerId")

    if (!partnerId) {
      // Return all DM conversations (latest message per partner) — fetch in parallel
      const [{ data: sent }, { data: received }] = await Promise.all([
        supabase
          .from("direct_messages")
          .select("receiver_id, created_at")
          .eq("sender_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("direct_messages")
          .select("sender_id, created_at")
          .eq("receiver_id", user.id)
          .order("created_at", { ascending: false }),
      ])

      const partnerIds = new Set<string>([
        ...(sent?.map((m) => m.receiver_id).filter((id): id is string => id !== null) ?? []),
        ...(received?.map((m) => m.sender_id) ?? []),
      ])

      if (partnerIds.size === 0) return NextResponse.json([])

      const { data: partners } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url, status, status_message")
        .in("id", Array.from(partnerIds))

      return NextResponse.json(partners ?? [])
    }

    // Validate partnerId is a valid UUID to prevent PostgREST filter injection
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(partnerId)) {
      return NextResponse.json({ error: "Invalid partnerId" }, { status: 400 })
    }

    // Get messages with specific partner
    const { data: messages, error } = await supabase
      .from("direct_messages")
      .select(`id, sender_id, receiver_id, content, created_at, edited_at, deleted_at, reply_to_id, dm_attachments(*), reactions(*)`)
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(100)

    if (error) return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })

    return NextResponse.json(messages ?? [])

  } catch (err) {
    log.error({ route: "/api/dm", action: "GET", error: err }, "GET error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const MAX_DM_CONTENT_LENGTH = 4000

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Rate limit: 15 messages per 10 seconds (matches newer DM route)
    const limited = await checkRateLimit(user.id, "dm:send", { limit: 15, windowMs: 10_000 })
    if (limited) return limited

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })
    }

    const receiverId = (payload as Record<string, unknown>).receiverId
    const content = (payload as Record<string, unknown>).content
    if (typeof receiverId !== "string" || typeof content !== "string") {
      return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })
    }

    const trimmed = content.trim()
    if (!receiverId || !trimmed) {
      return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })
    }

    // Validate receiverId is a valid UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(receiverId)) {
      return NextResponse.json({ error: "Invalid receiverId" }, { status: 400 })
    }

    // Content length validation
    if (trimmed.length > MAX_DM_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content exceeds maximum length of ${MAX_DM_CONTENT_LENGTH} characters` },
        { status: 400 },
      )
    }

    // Block check: prevent messaging blocked users
    const blocked = await isBlockedBetweenUsers(supabase, user.id, receiverId)
    if (blocked) {
      return NextResponse.json({ error: "Cannot send message to this user" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("direct_messages")
      .insert({ sender_id: user.id, receiver_id: receiverId, content: trimmed })
      .select()
      .single()

    if (error) return NextResponse.json({ error: "Failed to send message" }, { status: 500 })

    return NextResponse.json(data, { status: 201 })

  } catch (err) {
    log.error({ route: "/api/dm", action: "POST", error: err }, "POST error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
