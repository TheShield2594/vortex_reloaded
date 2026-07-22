import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

// PATCH /api/dm/channels/[channelId]/messages/[messageId] — edit a DM message
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const content = body?.content
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("direct_messages")
      .update({ content: content.trim(), edited_at: new Date().toISOString() })
      .eq("id", messageId)
      .eq("sender_id", user.id)
      .eq("dm_channel_id", channelId)
      .select()
      .single()

    if (error || !data) return NextResponse.json({ error: "Message not found or not editable" }, { status: 404 })

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/dm/channels/[channelId]/messages/[messageId] — soft-delete a DM message
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
) {
  try {
    const { channelId, messageId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await supabase
      .from("direct_messages")
      .update({ deleted_at: new Date().toISOString(), content: null })
      .eq("id", messageId)
      .eq("sender_id", user.id)
      .eq("dm_channel_id", channelId)
      .select("id")
      .single()

    if (error) return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
    if (!data) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
