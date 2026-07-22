import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveNotification, type NotificationMode, type NotificationSetting } from "@/lib/notification-resolver"

// GET /api/notification-settings?serverId=...&channelId=...
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const serverId = searchParams.get("serverId")
    const channelId = searchParams.get("channelId")
    const threadId = searchParams.get("threadId")

    if (threadId) {
      const { data: allSettings, error: allSettingsError } = await supabase
        .from("notification_settings")
        .select("id, user_id, server_id, channel_id, thread_id, mode")
        .eq("user_id", user.id)

      if (allSettingsError) {
        console.error("[api/notification-settings][GET] failed to fetch notification settings", { userId: user.id, action: "fetch_all_for_thread", threadId, error: allSettingsError.message })
        return NextResponse.json({ error: "Failed to fetch notification settings" }, { status: 500 })
      }

      const { data: thread, error: threadError } = await supabase
        .from("threads")
        .select("parent_channel_id, channels(server_id)")
        .eq("id", threadId)
        .maybeSingle()

      if (threadError) {
        console.error("[api/notification-settings][GET] failed to resolve thread notification context", { userId: user.id, action: "resolve_thread_context", threadId, error: threadError.message })
        return NextResponse.json({ error: "Failed to resolve thread notification context" }, { status: 500 })
      }

      if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 })
      }

      const derivedChannelId: string | null = thread?.parent_channel_id ?? null
      const derivedServerId: string | null = (thread?.channels as { server_id?: string | null } | null)?.server_id ?? null

      const explicit = (allSettings ?? []).find((row) => row.thread_id === threadId) ?? null
      const resolved = resolveNotification(
        user.id,
        derivedServerId,
        derivedChannelId,
        threadId,
        "message",
        (allSettings ?? []) as NotificationSetting[]
      )

      return NextResponse.json({
        mode: (resolved.mode ?? "all") as NotificationMode,
        explicit_mode: explicit?.mode ?? null,
        inherited: !explicit,
        thread_id: threadId,
        channel_id: derivedChannelId,
        server_id: derivedServerId,
      })
    }

    if (!serverId && !channelId) {
      // Return all settings for this user
      const { data, error } = await supabase
        .from("notification_settings")
        .select("id, user_id, server_id, channel_id, thread_id, mode")
        .eq("user_id", user.id)
      if (error) {
        console.error("[api/notification-settings][GET] failed to fetch notification settings", { userId: user.id, action: "fetch_all", error: error.message })
        return NextResponse.json({ error: "Failed to fetch notification settings" }, { status: 500 })
      }
      return NextResponse.json(data ?? [])
    }

    let query = supabase
      .from("notification_settings")
      .select("id, user_id, server_id, channel_id, thread_id, mode")
      .eq("user_id", user.id)

    if (serverId) query = query.eq("server_id", serverId)
    else if (channelId) query = query.eq("channel_id", channelId)

    const { data, error } = await query.maybeSingle()
    if (error) {
      console.error("[api/notification-settings][GET] failed to fetch notification setting", { userId: user.id, action: "fetch_single", serverId, channelId, error: error.message })
      return NextResponse.json({ error: "Failed to fetch notification setting" }, { status: 500 })
    }
    return NextResponse.json(data ?? { mode: "all" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/notification-settings — upsert a setting
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const payload = await req.json() as Record<string, unknown>
    const { serverId, channelId, threadId, mode } = payload

    if ((serverId !== undefined && typeof serverId !== "string")
      || (channelId !== undefined && typeof channelId !== "string")
      || (threadId !== undefined && typeof threadId !== "string")) {
      return NextResponse.json({ error: "serverId, channelId, and threadId must be strings" }, { status: 400 })
    }

    if (!["all", "mentions", "muted"].includes(String(mode))) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }
    if (!serverId && !channelId && !threadId) {
      return NextResponse.json({ error: "serverId, channelId, or threadId required" }, { status: 400 })
    }

    const row: {
      user_id: string
      mode: string
      updated_at: string
      server_id?: string | null
      channel_id?: string | null
      thread_id?: string | null
    } = { user_id: user.id, mode: String(mode), updated_at: new Date().toISOString() }
    if (threadId) {
      row.thread_id = threadId as string
    } else if (serverId) {
      row.server_id = serverId as string
    } else {
      row.channel_id = channelId as string
    }

    const { error } = await supabase
      .from("notification_settings")
      .upsert(row, {
        onConflict: threadId ? "user_id,thread_id" : (serverId ? "user_id,server_id" : "user_id,channel_id"),
      })

    if (error) return NextResponse.json({ error: "Failed to save notification setting" }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/notification-settings — reset to default
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const serverId = searchParams.get("serverId")
    const channelId = searchParams.get("channelId")
    const threadId = searchParams.get("threadId")

    let query = supabase
      .from("notification_settings")
      .delete()
      .eq("user_id", user.id)

    if (threadId) query = query.eq("thread_id", threadId)
    else if (serverId) query = query.eq("server_id", serverId)
    else if (channelId) query = query.eq("channel_id", channelId)
    else return NextResponse.json({ error: "serverId, channelId, or threadId required" }, { status: 400 })

    const { data, error } = await query.select("user_id").limit(1)
    if (error) return NextResponse.json({ error: "Failed to delete notification setting" }, { status: 500 })

    const deleted = (data?.length ?? 0) > 0
    if (!deleted) return NextResponse.json({ ok: true, deleted: false }, { status: 404 })
    return NextResponse.json({ ok: true, deleted: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
