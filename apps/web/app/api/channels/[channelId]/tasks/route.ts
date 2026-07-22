import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireWorkspaceAccess } from "@/lib/workspace-auth"

export async function GET(_: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: channel } = await supabase.from("channels").select("server_id").eq("id", channelId).single()
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

    const access = await requireWorkspaceAccess(supabase, channel.server_id, user.id)
    if (!access.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data, error } = await supabase
      .from("channel_tasks")
      .select("*, assignee:users!channel_tasks_assignee_id_fkey(id, username, display_name, avatar_url)")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 })
    return NextResponse.json({ tasks: data ?? [] })

  } catch (err) {
    console.error("[channels/[channelId]/tasks GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: channel } = await supabase.from("channels").select("server_id").eq("id", channelId).single()
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

    const access = await requireWorkspaceAccess(supabase, channel.server_id, user.id)
    if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await req.json()
    const payload = {
      server_id: channel.server_id,
      channel_id: channelId,
      title: (body.title || "").trim(),
      description: body.description?.trim() || null,
      status: body.status || "todo",
      due_date: body.dueDate || null,
      assignee_id: body.assigneeId || null,
      source_message_id: body.sourceMessageId || null,
      created_by: user.id,
      updated_by: user.id,
    }
    if (!payload.title) return NextResponse.json({ error: "title required" }, { status: 400 })

    const { data, error } = await supabase.from("channel_tasks").insert(payload).select("id, title, description, status, due_date, assignee_id, channel_id, server_id, source_message_id, created_by, updated_by, created_at, updated_at").single()
    if (error) return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
    return NextResponse.json({ task: data }, { status: 201 })

  } catch (err) {
    console.error("[channels/[channelId]/tasks POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: channel } = await supabase.from("channels").select("server_id").eq("id", channelId).single()
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

    const access = await requireWorkspaceAccess(supabase, channel.server_id, user.id)
    if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await req.json()
    const { taskId, status } = body
    if (typeof taskId !== "string" || !taskId.trim()) return NextResponse.json({ error: "taskId required" }, { status: 400 })
    if (!["todo", "done"].includes(status)) return NextResponse.json({ error: "invalid status" }, { status: 400 })

    const { data, error } = await supabase
      .from("channel_tasks")
      .update({ status, updated_by: user.id })
      .eq("id", taskId)
      .eq("channel_id", channelId)
      .select("id, title, description, status, due_date, assignee_id, channel_id, server_id, source_message_id, created_by, updated_by, created_at, updated_at")
      .single()

    if (error) return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
    return NextResponse.json({ task: data })

  } catch (err) {
    console.error("[channels/[channelId]/tasks PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: channel } = await supabase.from("channels").select("server_id").eq("id", channelId).single()
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

    const access = await requireWorkspaceAccess(supabase, channel.server_id, user.id)
    if (!access.canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { taskId } = await req.json()
    if (typeof taskId !== "string" || !taskId.trim()) return NextResponse.json({ error: "taskId required" }, { status: 400 })

    const { error } = await supabase.from("channel_tasks").delete().eq("id", taskId).eq("channel_id", channelId)
    if (error) return NextResponse.json({ error: "Failed to delete task" }, { status: 500 })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[channels/[channelId]/tasks DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
