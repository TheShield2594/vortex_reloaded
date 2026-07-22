import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { createServerSupabaseClient } from "@/lib/supabase/server"

type Params = { params: Promise<{ serverId: string }> }

const MAX_REMINDER_MINUTES = 1440 // 24 hours

/**
 * GET /api/servers/[serverId]/apps/reminder
 * Returns reminder config + user's active reminders.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [configResult, remindersResult] = await Promise.all([
      supabase
        .from("reminder_app_configs")
        .select("*")
        .eq("server_id", serverId)
        .maybeSingle(),
      supabase
        .from("reminders")
        .select("id, user_id, channel_id, message, remind_at, delivered, created_at")
        .eq("server_id", serverId)
        .eq("user_id", user.id)
        .eq("delivered", false)
        .order("remind_at", { ascending: true }),
    ])

    if (configResult.error) return NextResponse.json({ error: "Failed to fetch reminder configuration" }, { status: 500 })

    return NextResponse.json({
      config: configResult.data,
      reminders: remindersResult.data ?? [],
      currentUserId: user.id,
    })

  } catch (err) {
    console.error("[servers/[serverId]/apps/reminder GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/apps/reminder
 * Actions: save_config, create_reminder, cancel_reminder
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const action = body.action as string

  // Save config — requires MANAGE_CHANNELS
  if (action === "save_config") {
    const { supabase: authSupabase, error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const { channel_id, max_reminders_per_user, enabled } = body as {
      channel_id?: string | null
      max_reminders_per_user?: number
      enabled?: boolean
    }

    if (channel_id) {
      const { data: ch } = await authSupabase
        .from("channels")
        .select("id")
        .eq("id", channel_id)
        .eq("server_id", serverId)
        .single()
      if (!ch) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
    }

    const maxReminders = Math.min(25, Math.max(1, max_reminders_per_user ?? 10))

    const upsertData = {
      server_id: serverId,
      ...(channel_id !== undefined && { channel_id }),
      max_reminders_per_user: maxReminders,
      ...(enabled !== undefined && { enabled }),
    }

    const { data, error } = await authSupabase
      .from("reminder_app_configs")
      .upsert(upsertData, { onConflict: "server_id" })
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to save reminder configuration" }, { status: 500 })
    return NextResponse.json(data)
  }

  // Create reminder
  if (action === "create_reminder") {
    const minutes = body.minutes as number
    const message = (body.message as string)?.trim()

    if (!message || message.length > 500) {
      return NextResponse.json({ error: "Message is required (max 500 characters)" }, { status: 400 })
    }

    if (typeof minutes !== "number" || minutes < 1 || minutes > MAX_REMINDER_MINUTES) {
      return NextResponse.json({ error: "Time must be between 1 minute and 24 hours" }, { status: 400 })
    }

    // Check per-user limit
    const { data: configData } = await supabase
      .from("reminder_app_configs")
      .select("max_reminders_per_user, enabled, channel_id")
      .eq("server_id", serverId)
      .maybeSingle()

    if (configData && !configData.enabled) {
      return NextResponse.json({ error: "Reminder Bot is disabled on this server" }, { status: 400 })
    }

    const maxAllowed = configData?.max_reminders_per_user ?? 10

    const { count } = await supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .eq("delivered", false)

    if ((count ?? 0) >= maxAllowed) {
      return NextResponse.json({ error: `You can have at most ${maxAllowed} active reminders` }, { status: 400 })
    }

    const remindAt = new Date(Date.now() + minutes * 60000).toISOString()

    // Use the configured default channel, or require one exists
    const channelId = configData?.channel_id
    if (!channelId) {
      return NextResponse.json({ error: "No reminder channel configured. Ask an admin to set one." }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("reminders")
      .insert({
        server_id: serverId,
        channel_id: channelId,
        user_id: user.id,
        message,
        remind_at: remindAt,
      })
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to create reminder" }, { status: 500 })
    return NextResponse.json(data)
  }

  // Cancel reminder
  if (action === "cancel_reminder") {
    const reminderId = body.reminder_id as string
    if (!reminderId) return NextResponse.json({ error: "reminder_id is required" }, { status: 400 })

    const { error } = await supabase
      .from("reminders")
      .delete()
      .eq("id", reminderId)
      .eq("user_id", user.id)
      .eq("server_id", serverId)

    if (error) return NextResponse.json({ error: "Failed to cancel reminder" }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
