/**
 * GET /api/servers/[serverId]/admin/simulate
 *
 * Preview the effective permissions for a role or member, optionally scoped to
 * a channel.  Only server owners / administrators may call this.
 *
 * Query params:
 *   roleId    – simulate for a specific role (treats it as the sole assigned role)
 *   userId    – simulate for a specific member (uses all their assigned roles)
 *   channelId – (optional) apply channel overwrites for the given channel
 *
 * Exactly one of roleId or userId must be supplied.
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions } from "@/lib/permissions"
import { simulatePermissions, type RoleSnapshot, type ChannelOverwriteSnapshot } from "@/lib/permission-simulation"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Only admins may use the simulation tool
    const { isAdmin } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const roleId = searchParams.get("roleId")
    const userId = searchParams.get("userId")
    const channelId = searchParams.get("channelId")

    if (!roleId && !userId) {
      return NextResponse.json({ error: "Provide roleId or userId" }, { status: 400 })
    }
    if (roleId && userId) {
      return NextResponse.json({ error: "Provide either roleId or userId, not both" }, { status: 400 })
    }

    // Fetch all roles for this server
    const { data: allRoles, error: rolesError } = await supabase
      .from("roles")
      .select("id, name, permissions, is_default, position, color")
      .eq("server_id", serverId)
    if (rolesError) return NextResponse.json({ error: "Failed to load roles" }, { status: 500 })

    const rolesMap = new Map<string, RoleSnapshot>((allRoles ?? []).map((r) => [r.id, r as RoleSnapshot]))
    const defaultRole = (allRoles ?? []).find((r) => r.is_default) ?? null

    // Determine which roles the subject holds
    let assignedRoles: RoleSnapshot[] = []
    let isOwner = false

    if (roleId) {
      // Single-role simulation
      const role = rolesMap.get(roleId)
      if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 })
      assignedRoles = [role]
    } else if (userId) {
      // Member simulation
      const { data: server } = await supabase
        .from("servers")
        .select("owner_id")
        .eq("id", serverId)
        .single()
      isOwner = server?.owner_id === userId

      const { data: memberRoles, error: mrError } = await supabase
        .from("member_roles")
        .select("role_id")
        .eq("server_id", serverId)
        .eq("user_id", userId)
      if (mrError) return NextResponse.json({ error: "Failed to load member roles" }, { status: 500 })

      assignedRoles = (memberRoles ?? [])
        .map((mr) => rolesMap.get(mr.role_id))
        .filter((r): r is RoleSnapshot => !!r)
    }

    // Fetch channel overwrites if channelId provided
    let overwrites: ChannelOverwriteSnapshot[] = []
    if (channelId) {
      const relevantRoleIds = new Set<string>(assignedRoles.map((r) => r.id))
      if (defaultRole) relevantRoleIds.add(defaultRole.id)

      const { data: owData, error: owError } = await supabase
        .from("channel_permissions")
        .select("role_id, allow_permissions, deny_permissions")
        .eq("channel_id", channelId)
        .in("role_id", Array.from(relevantRoleIds))
      if (owError) return NextResponse.json({ error: "Failed to load channel overwrites" }, { status: 500 })
      overwrites = (owData ?? []) as ChannelOverwriteSnapshot[]
    }

    const result = simulatePermissions(
      assignedRoles,
      defaultRole as RoleSnapshot | null,
      overwrites,
      isOwner
    )

    return NextResponse.json({
      serverId,
      roleId: roleId ?? null,
      userId: userId ?? null,
      channelId: channelId ?? null,
      isOwner,
      ...result,
    })

  } catch (err) {
    console.error("[servers/[serverId]/admin/simulate GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
