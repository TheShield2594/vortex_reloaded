import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"
import { VALID_AUTO_ARCHIVE_DURATIONS } from "@vortex/shared"

interface Params {
  params: Promise<{ threadId: string }>
}

// GET /api/threads/[threadId]
export async function GET(_request: Request, { params: paramsPromise }: Params) {
  try {
    const { threadId } = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: thread, error } = await supabase
      .from("threads")
      .select(`
        *,
        owner:users!threads_owner_id_fkey(*),
        starter_message:messages!threads_starter_message_id_fkey(
          *,
          author:users!messages_author_id_fkey(*),
          attachments(*),
          reactions(*)
        ),
        members:thread_members(*)
      `)
      .eq("id", threadId)
      .single()

    if (error) return NextResponse.json({ error: "Failed to fetch thread" }, { status: 500 })
    if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

    return NextResponse.json(thread)

  } catch (err) {
    console.error("[threads/[threadId] GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/threads/[threadId]  { archived?, locked?, name?, auto_archive_duration? }
export async function PATCH(request: Request, { params: paramsPromise }: Params) {
  try {
  const { threadId } = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Fetch thread + parent channel for authorization
  const { data: existing, error: fetchError } = await supabase
    .from("threads")
    .select("id, owner_id, parent_channel_id, channels(server_id)")
    .eq("id", threadId)
    .single()

  if (fetchError || !existing) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  // Authorization: thread owner or users with MANAGE_CHANNELS permission
  const serverId = (existing.channels as { server_id?: string | null } | null)?.server_id ?? null
  let authorized = existing.owner_id === user.id
  if (!authorized && serverId) {
    const { isAdmin, permissions } = await getChannelPermissions(supabase, serverId, existing.parent_channel_id, user.id)
    authorized = isAdmin || hasPermission(permissions, "MANAGE_CHANNELS")
  }
  if (!authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  let body: {
    archived?: boolean
    locked?: boolean
    name?: string
    auto_archive_duration?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.archived === "boolean") {
    updates.archived = body.archived
    updates.archived_at = body.archived ? new Date().toISOString() : null
  }
  if (typeof body.locked === "boolean") updates.locked = body.locked
  if (body.name?.trim()) updates.name = body.name.trim()
  if (typeof body.auto_archive_duration === "number") {
    if (!VALID_AUTO_ARCHIVE_DURATIONS.has(body.auto_archive_duration)) {
      return NextResponse.json(
        { error: `Invalid auto_archive_duration. Must be one of: ${[...VALID_AUTO_ARCHIVE_DURATIONS].join(", ")}.` },
        { status: 400 }
      )
    }
    updates.auto_archive_duration = body.auto_archive_duration
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { data: thread, error } = await supabase
    .from("threads")
    .update(updates)
    .eq("id", threadId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Failed to update thread" }, { status: 500 })

  return NextResponse.json(thread)
  } catch (err) {
    console.error("[threads/[threadId] PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/threads/[threadId]
export async function DELETE(_request: Request, { params: paramsPromise }: Params) {
  try {
    const { threadId } = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Fetch thread for authorization
    const { data: existing, error: fetchError } = await supabase
      .from("threads")
      .select("id, owner_id, parent_channel_id, channels(server_id)")
      .eq("id", threadId)
      .single()

    if (fetchError || !existing) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

    // Authorization: thread owner or users with MANAGE_CHANNELS permission
    const serverId = (existing.channels as { server_id?: string | null } | null)?.server_id ?? null
    let authorized = existing.owner_id === user.id
    if (!authorized && serverId) {
      const { isAdmin, permissions } = await getChannelPermissions(supabase, serverId, existing.parent_channel_id, user.id)
      authorized = isAdmin || hasPermission(permissions, "MANAGE_CHANNELS")
    }
    if (!authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { error } = await supabase.from("threads").delete().eq("id", threadId)
    if (error) return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[threads/[threadId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
