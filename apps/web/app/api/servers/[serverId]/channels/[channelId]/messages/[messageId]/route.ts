import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"

// PATCH /api/servers/[serverId]/channels/[channelId]/messages/[messageId] — edit a server channel message
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; channelId: string; messageId: string }> }
) {
  try {
  const { serverId, channelId, messageId } = await params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let content: unknown
  try {
    const body = await req.json()
    content = body.content
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof content !== "string" || !content.trim())
    return NextResponse.json({ error: "Content required" }, { status: 400 })

  // Verify the channel belongs to this server
  const { data: channelRow } = await supabase
    .from("channels")
    .select("id")
    .eq("id", channelId)
    .eq("server_id", serverId)
    .single()

  if (!channelRow)
    return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  // Verify the message exists and belongs to this channel
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .select("id, author_id, channel_id")
    .eq("id", messageId)
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .single()

  if (msgError || !message)
    return NextResponse.json({ error: "Message not found" }, { status: 404 })

  // Permission check: message author can edit their own messages if still a member.
  // Users with MANAGE_MESSAGES (or ADMINISTRATOR) can edit any message.
  const isAuthor = message.author_id === user.id

  if (isAuthor) {
    // Verify the author is still a server member
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: "You are no longer a member of this server" }, { status: 403 })
    }
  }

  if (!isAuthor) {
    const { isAdmin, permissions } = await getChannelPermissions(
      supabase,
      serverId,
      channelId,
      user.id
    )

    if (!isAdmin && !hasPermission(permissions, "MANAGE_MESSAGES")) {
      return NextResponse.json(
        { error: "You can only edit your own messages unless you have MANAGE_MESSAGES permission" },
        { status: 403 }
      )
    }
  }

  const { data, error } = await supabase
    .from("messages")
    .update({ content: content.trim(), edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .select()
    .single()

  if (error || !data)
    return NextResponse.json(
      { error: "Database operation failed" },
      { status: error ? 500 : 404 }
    )

  return NextResponse.json(data)
  } catch (err) {
    console.error("[messages PATCH] unhandled error:", err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/servers/[serverId]/channels/[channelId]/messages/[messageId] — soft-delete a message
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string; channelId: string; messageId: string }> }
) {
  try {
    const { serverId, channelId, messageId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify channel belongs to this server
    const { data: channelRow } = await supabase
      .from("channels")
      .select("id")
      .eq("id", channelId)
      .eq("server_id", serverId)
      .single()

    if (!channelRow)
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })

    // Verify message exists in this channel
    const { data: message } = await supabase
      .from("messages")
      .select("id, author_id")
      .eq("id", messageId)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .single()

    if (!message)
      return NextResponse.json({ error: "Message not found" }, { status: 404 })

    // Permission: author can delete own, or user needs MANAGE_MESSAGES
    const isAuthor = message.author_id === user.id
    if (!isAuthor) {
      const { isAdmin, permissions } = await getChannelPermissions(supabase, serverId, channelId, user.id)
      if (!isAdmin && !hasPermission(permissions, "MANAGE_MESSAGES")) {
        return NextResponse.json({ error: "You can only delete your own messages" }, { status: 403 })
      }
    }

    // Use service role to bypass RLS for the soft-delete update
    const admin = await createServiceRoleClient()
    const { error } = await admin
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId)

    if (error)
      return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[servers/[serverId]/channels/[channelId]/messages/[messageId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
