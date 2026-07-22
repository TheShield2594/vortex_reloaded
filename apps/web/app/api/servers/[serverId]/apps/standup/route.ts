import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { createServerSupabaseClient } from "@/lib/supabase/server"

type Params = { params: Promise<{ serverId: string }> }

/**
 * GET /api/servers/[serverId]/apps/standup
 * Returns standup config + today's entries.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const today = new Date().toISOString().split("T")[0]

    const [configResult, entriesResult] = await Promise.all([
      supabase
        .from("standup_app_configs")
        .select("*")
        .eq("server_id", serverId)
        .maybeSingle(),
      supabase
        .from("standup_entries")
        .select("id, user_id, answers, standup_date, submitted_at, users:user_id(display_name, username, avatar_url)")
        .eq("server_id", serverId)
        .eq("standup_date", today)
        .order("submitted_at", { ascending: true }),
    ])

    if (configResult.error) return NextResponse.json({ error: "Failed to fetch standup configuration" }, { status: 500 })

    return NextResponse.json({
      config: configResult.data,
      entries: entriesResult.data ?? [],
      currentUserId: user.id,
    })

  } catch (err) {
    console.error("[servers/[serverId]/apps/standup GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/apps/standup
 * Actions: save_config, submit_standup, view_date
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
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

    const { channel_id, reminder_time, timezone, questions, days_active, enabled } = body as {
      channel_id?: string | null
      reminder_time?: string
      timezone?: string
      questions?: string[]
      days_active?: number[]
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

    if (questions && (!Array.isArray(questions) || questions.length > 10 || questions.length < 1)) {
      return NextResponse.json({ error: "Questions must be an array with 1-10 items" }, { status: 400 })
    }

    if (days_active && (!Array.isArray(days_active) || days_active.some((d: number) => d < 1 || d > 7))) {
      return NextResponse.json({ error: "days_active must contain values 1-7 (Mon-Sun)" }, { status: 400 })
    }

    const upsertData = {
      server_id: serverId,
      ...(channel_id !== undefined && { channel_id }),
      ...(reminder_time !== undefined && { reminder_time }),
      ...(timezone !== undefined && { timezone }),
      ...(questions !== undefined && { questions: JSON.stringify(questions) }),
      ...(days_active !== undefined && { days_active }),
      ...(enabled !== undefined && { enabled }),
    }

    const { data, error } = await authSupabase
      .from("standup_app_configs")
      .upsert(upsertData, { onConflict: "server_id" })
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to save standup configuration" }, { status: 500 })
    return NextResponse.json(data)
  }

  // Submit standup
  if (action === "submit_standup") {
    const answers = body.answers as string[]
    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: "answers array is required" }, { status: 400 })
    }

    const today = new Date().toISOString().split("T")[0]

    const { data, error } = await supabase
      .from("standup_entries")
      .upsert(
        {
          server_id: serverId,
          user_id: user.id,
          answers: JSON.stringify(answers),
          standup_date: today,
        },
        { onConflict: "server_id,user_id,standup_date" }
      )
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to submit standup entry" }, { status: 500 })
    return NextResponse.json(data)
  }

  // View specific date
  if (action === "view_date") {
    const date = body.date as string
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("standup_entries")
      .select("id, user_id, answers, standup_date, submitted_at, users:user_id(display_name, username, avatar_url)")
      .eq("server_id", serverId)
      .eq("standup_date", date)
      .order("submitted_at", { ascending: true })

    if (error) return NextResponse.json({ error: "Failed to fetch standup entries" }, { status: 500 })
    return NextResponse.json({ entries: data ?? [] })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[servers/[serverId]/apps/standup POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
