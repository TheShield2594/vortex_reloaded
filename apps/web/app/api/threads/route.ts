import { type NextRequest, NextResponse } from "next/server"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { VALID_AUTO_ARCHIVE_DURATIONS, DEFAULT_AUTO_ARCHIVE_DURATION } from "@vortex/shared"

/** GET /api/threads?channelId=xxx&archived=false — Lists threads for a channel, ordered by most recently updated. */
export async function GET(request: Request) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get("channelId")
    const archived = searchParams.get("archived") === "true"

    if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 })

    const { data: threads, error } = await supabase
      .from("threads")
      .select("id, parent_channel_id, starter_message_id, owner_id, name, archived, auto_archive_duration, message_count, created_at, updated_at")
      .eq("parent_channel_id", channelId)
      .eq("archived", archived)
      .order("updated_at", { ascending: false })

    if (error) {
      console.error("[threads] GET query failed", { channelId, code: error.code, message: error.message, details: error.details })
      return NextResponse.json({ error: "Failed to fetch threads" }, { status: 500 })
    }

    const threadList = threads ?? []

    // Attach is_unread by joining thread_read_states for the current user
    if (threadList.length > 0) {
      const { data: readStates } = await supabase
        .from("thread_read_states")
        .select("thread_id, last_read_at")
        .eq("user_id", user.id)
        .in("thread_id", threadList.map((t) => t.id))

      const readMap = new Map((readStates ?? []).map((rs) => [rs.thread_id, rs.last_read_at]))

      const withUnread = threadList.map((t) => {
        const lastRead = readMap.get(t.id)
        return { ...t, is_unread: lastRead ? t.updated_at > lastRead : true }
      })

      return NextResponse.json(withUnread, {
        headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
      })
    }

    return NextResponse.json(threadList, {
      headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
    })
  } catch (err) {
    console.error("[threads GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/threads — Creates a new thread, either from an existing message or directly from a channel. */
export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "threads:create", { limit: 30, windowMs: 3600_000 })
    if (limited) return limited

    const { data: body, error: parseError } = await parseJsonBody<{ messageId?: string; channelId?: string; name: string; autoArchiveDuration?: number }>(request as unknown as NextRequest)
    if (parseError) return parseError

    const { messageId, channelId, name, autoArchiveDuration } = body

    // Validate auto_archive_duration — reject invalid values (matches PATCH behavior)
    if (autoArchiveDuration !== undefined && !VALID_AUTO_ARCHIVE_DURATIONS.has(autoArchiveDuration)) {
      return NextResponse.json(
        { error: `Invalid autoArchiveDuration. Must be one of: ${[...VALID_AUTO_ARCHIVE_DURATIONS].join(", ")}.` },
        { status: 400 }
      )
    }
    const duration = autoArchiveDuration ?? DEFAULT_AUTO_ARCHIVE_DURATION
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 })

    if (messageId) {
      // Create thread from an existing message
      const { data: thread, error } = await supabase.rpc("create_thread_from_message", {
        p_message_id: messageId,
        p_name: name.trim(),
        p_auto_archive_duration: duration,
      })
      if (error) return NextResponse.json({ error: "Failed to create thread" }, { status: 500 })
      return NextResponse.json(thread, { status: 201 })
    }

    if (channelId) {
      // Resolve server_id from the parent channel for denormalized column (#657)
      const { data: parentChannel } = await supabase
        .from("channels")
        .select("server_id")
        .eq("id", channelId)
        .maybeSingle()

      // Create standalone thread in a channel (no starter message)
      const { data: thread, error } = await supabase
        .from("threads")
        .insert({
          parent_channel_id: channelId,
          owner_id: user.id,
          name: name.trim(),
          auto_archive_duration: duration,
          ...(parentChannel?.server_id ? { server_id: parentChannel.server_id } : {}),
        })
        .select("id, parent_channel_id, starter_message_id, owner_id, name, archived, auto_archive_duration, message_count, server_id, created_at, updated_at")
        .single()
      if (error) return NextResponse.json({ error: "Failed to create thread" }, { status: 500 })
      return NextResponse.json(thread, { status: 201 })
    }

    return NextResponse.json({ error: "messageId or channelId required" }, { status: 400 })
  } catch (err) {
    console.error("[threads POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
