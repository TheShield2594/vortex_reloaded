import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission, invalidateChannelPermissions } from "@/lib/permissions"

/** Resolve the channel's server_id and verify the user has MANAGE_CHANNELS permission. */
async function resolveChannelWithPermission(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  channelId: string,
  userId: string,
): Promise<{ serverId: string } | NextResponse> {
  const { data: ch, error: chError } = await supabase
    .from("channels")
    .select("server_id")
    .eq("id", channelId)
    .single()

  if (chError || !ch) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  const perms = await getMemberPermissions(supabase, ch.server_id, userId)
  if (!perms.isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  return { serverId: ch.server_id }
}

/** Same as above but also requires MANAGE_CHANNELS for write operations. */
async function resolveChannelWithManagePermission(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  channelId: string,
  userId: string,
): Promise<{ serverId: string } | NextResponse> {
  const { data: ch, error: chError } = await supabase
    .from("channels")
    .select("server_id")
    .eq("id", channelId)
    .single()

  if (chError || !ch) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  const perms = await getMemberPermissions(supabase, ch.server_id, userId)
  if (!perms.isAdmin && !hasPermission(perms.permissions, "MANAGE_CHANNELS")) {
    return NextResponse.json({ error: "Missing MANAGE_CHANNELS permission" }, { status: 403 })
  }

  return { serverId: ch.server_id }
}

// GET /api/channels/[channelId]/permissions — fetch all role overrides for a channel
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const result = await resolveChannelWithPermission(supabase, channelId, user.id)
    if (result instanceof NextResponse) return result

    const { data, error } = await supabase
      .from("channel_permissions")
      .select("*, role:roles(id, name, color)")
      .eq("channel_id", channelId)

    if (error) return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 })
    return NextResponse.json(data ?? [])

  } catch (err) {
    console.error("[channels/[channelId]/permissions GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/channels/[channelId]/permissions — upsert a role override
// Body: { roleId, allowPermissions, denyPermissions }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { roleId, allowPermissions = 0, denyPermissions = 0 } = await req.json()
    if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 })

    const result = await resolveChannelWithManagePermission(supabase, channelId, user.id)
    if (result instanceof NextResponse) return result

    const { error } = await supabase
      .from("channel_permissions")
      .upsert(
        {
          channel_id: channelId,
          role_id: roleId,
          allow_permissions: allowPermissions,
          deny_permissions: denyPermissions,
        },
        { onConflict: "channel_id,role_id" }
      )

    if (error) return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 })
    invalidateChannelPermissions(result.serverId, channelId)
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[channels/[channelId]/permissions PUT] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/channels/[channelId]/permissions?roleId=... — remove a role override
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const roleId = searchParams.get("roleId")
    if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 })

    const result = await resolveChannelWithManagePermission(supabase, channelId, user.id)
    if (result instanceof NextResponse) return result

    const { error } = await supabase
      .from("channel_permissions")
      .delete()
      .eq("channel_id", channelId)
      .eq("role_id", roleId)

    if (error) return NextResponse.json({ error: "Failed to delete permissions" }, { status: 500 })
    invalidateChannelPermissions(result.serverId, channelId)
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[channels/[channelId]/permissions DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
