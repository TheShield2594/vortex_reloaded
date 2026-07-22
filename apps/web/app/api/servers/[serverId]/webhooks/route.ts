import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"

// GET /api/servers/[serverId]/webhooks
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin && !hasPermission(permissions, "MANAGE_WEBHOOKS")) {
      return NextResponse.json({ error: "Missing MANAGE_WEBHOOKS permission" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("webhooks")
      .select("id, name, avatar_url, channel_id, created_at")
      .eq("server_id", serverId)
      .order("created_at")

    if (error) return NextResponse.json({ error: "Failed to fetch webhooks" }, { status: 500 })
    // Token is omitted from list responses — it is only returned at creation time
    return NextResponse.json(data ?? [])

  } catch (err) {
    console.error("[servers/[serverId]/webhooks GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/servers/[serverId]/webhooks — create webhook
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
  if (!isAdmin && !hasPermission(permissions, "MANAGE_WEBHOOKS")) {
    return NextResponse.json({ error: "Missing MANAGE_WEBHOOKS permission" }, { status: 403 })
  }

  let channelId: string | undefined
  let name: string | undefined
  try {
    const body = await req.json()
    channelId = body.channelId
    name = body.name
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 })

  const { data, error } = await supabase
    .from("webhooks")
    .insert({ server_id: serverId, channel_id: channelId, name: name ?? "Webhook", created_by: user.id })
    .select("id, name, token, channel_id, created_at")
    .single()

  if (error || !data) return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
  return NextResponse.json({ ...data, url: `${appUrl}/api/webhooks/${data.token}` }, { status: 201 })
  } catch (err) {
    console.error("[servers/[serverId]/webhooks POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/servers/[serverId]/webhooks?webhookId=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin && !hasPermission(permissions, "MANAGE_WEBHOOKS")) {
      return NextResponse.json({ error: "Missing MANAGE_WEBHOOKS permission" }, { status: 403 })
    }

    const webhookId = req.nextUrl.searchParams.get("webhookId")
    if (!webhookId) return NextResponse.json({ error: "webhookId required" }, { status: 400 })

    const { error } = await supabase
      .from("webhooks")
      .delete()
      .eq("id", webhookId)
      .eq("server_id", serverId)

    if (error) return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[servers/[serverId]/webhooks DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
