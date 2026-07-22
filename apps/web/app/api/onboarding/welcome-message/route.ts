import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"

/**
 * POST /api/onboarding/welcome-message
 *
 * Posts a welcome message from the system bot in the first text channel
 * of a newly created server. Called during onboarding after server creation.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { serverId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const serverId = body.serverId
  if (!serverId) {
    return NextResponse.json({ error: "serverId is required" }, { status: 400 })
  }

  // Verify the requesting user owns the server
  const { data: server } = await supabase
    .from("servers")
    .select("id, name, owner_id")
    .eq("id", serverId)
    .single()

  if (!server || server.owner_id !== user.id) {
    return NextResponse.json({ error: "Not the server owner" }, { status: 403 })
  }

  // Find the first text channel (by position) in this server
  const { data: channels } = await supabase
    .from("channels")
    .select("id, name, type")
    .eq("server_id", serverId)
    .in("type", ["text"])
    .order("position", { ascending: true })
    .limit(1)

  if (!channels || channels.length === 0) {
    return NextResponse.json({ ok: true, message: "No text channels to post in" })
  }

  const targetChannel = channels[0]

  // Use service role to insert as system bot (bypasses RLS)
  const serviceClient = await createServiceRoleClient()
  const welcomeContent = [
    `Welcome to **${server.name}**! This is your brand new server.`,
    "",
    "Here are a few things to get started:",
    "- **Invite friends** using the invite link in server settings",
    "- **Create channels** to organize conversations by topic",
    "- **Set up roles** to manage permissions for your community",
    "",
    "Have fun building your community!",
  ].join("\n")

  const { error: msgError } = await serviceClient
    .from("messages")
    .insert({
      channel_id: targetChannel.id,
      author_id: SYSTEM_BOT_ID,
      content: welcomeContent,
    })

  if (msgError) {
    console.error("Failed to post welcome message:", msgError.message)
    return NextResponse.json({ error: "Failed to post welcome message" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
