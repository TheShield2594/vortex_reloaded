import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

const NOTIFICATION_COLUMNS = "id, type, title, body, icon_url, server_id, channel_id, message_id, read, created_at"

// GET /api/notifications — fetch notifications for the current user
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get("limit")
    const parsed = limitParam ? Number(limitParam) : NaN
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), 100) : 30

    const countOnly = searchParams.get("countOnly") === "true"
    if (countOnly) {
      const { count, error: countError } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false)
      if (countError) return NextResponse.json({ error: "Failed to fetch unread count" }, { status: 500 })
      return NextResponse.json({ unreadCount: count ?? 0 })
    }

    const { data, error } = await supabase
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
    return NextResponse.json({ notifications: data ?? [] })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/notifications — mark notifications as read
// Body: { id?: string } — if id is provided mark that one; otherwise mark all unread as read
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json() as Record<string, unknown>
    const { id } = body

    if (id !== undefined && (typeof id !== "string" || id.trim() === "")) {
      return NextResponse.json({ error: "id must be a non-empty string" }, { status: 400 })
    }

    let query = supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)

    const trimmedId = typeof id === "string" ? id.trim() : undefined
    if (trimmedId) {
      query = query.eq("id", trimmedId)
    } else {
      query = query.eq("read", false)
    }

    const { error } = await query
    if (error) return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/notifications — dismiss notifications
// Body: { id?: string, ids?: string[] }
// - id: delete a single notification
// - ids: delete specific notifications by ID
// - neither: error (prevent accidental mass deletion)
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json() as Record<string, unknown>
    const { id, ids } = body

    if (id !== undefined && (typeof id !== "string" || id.trim() === "")) {
      return NextResponse.json({ error: "id must be a non-empty string" }, { status: 400 })
    }
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((v) => typeof v === "string"))) {
      return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 })
    }
    if (!id && !ids) {
      return NextResponse.json({ error: "id or ids required" }, { status: 400 })
    }

    let query = supabase
      .from("notifications")
      .delete()
      .eq("user_id", user.id)

    const trimmedDeleteId = typeof id === "string" ? id.trim() : undefined
    const trimmedIds = Array.isArray(ids) ? ids.map((s: string) => s.trim()).filter(Boolean) : undefined
    if (trimmedDeleteId) {
      query = query.eq("id", trimmedDeleteId)
    } else if (trimmedIds) {
      if (trimmedIds.length === 0) {
        return NextResponse.json({ error: "No valid IDs provided" }, { status: 400 })
      }
      query = query.in("id", trimmedIds)
    }

    const { error } = await query
    if (error) return NextResponse.json({ error: "Failed to delete notifications" }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
