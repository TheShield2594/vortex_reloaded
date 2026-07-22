import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireWorkspaceAccess } from "@/lib/workspace-auth"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const { docId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: existing } = await supabase.from("channel_docs").select("id, server_id").eq("id", docId).single()
    if (!existing) return NextResponse.json({ error: "Doc not found" }, { status: 404 })

    const access = await requireWorkspaceAccess(supabase, existing.server_id, user.id)
    if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await req.json()
    const patch: Record<string, unknown> = { updated_by: user.id }
    if (typeof body.title === "string") patch.title = body.title.trim()
    if (typeof body.content === "string") patch.content = body.content

    const { data, error } = await supabase.from("channel_docs").update(patch).eq("id", docId).select("*").single()
    if (error) return NextResponse.json({ error: "Failed to update document" }, { status: 500 })
    return NextResponse.json({ doc: data })

  } catch (err) {
    console.error("[docs/[docId] PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const { docId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: existing } = await supabase.from("channel_docs").select("id, server_id").eq("id", docId).single()
    if (!existing) return NextResponse.json({ error: "Doc not found" }, { status: 404 })

    const access = await requireWorkspaceAccess(supabase, existing.server_id, user.id)
    if (!access.canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { error } = await supabase.from("channel_docs").delete().eq("id", docId)
    if (error) return NextResponse.json({ error: "Failed to delete document" }, { status: 500 })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[docs/[docId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
