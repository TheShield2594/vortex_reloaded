import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission, invalidateServerPermissions } from "@/lib/permissions"
import { getActorMaxRolePosition } from "@/lib/role-utils"
import { rateLimiter } from "@/lib/rate-limit"
import { invalidatePrefix } from "@/lib/server-cache"

async function assertRoleMutationAllowed(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  serverId: string,
  actorUserId: string,
  roleId: string,
  denyMessage: string,
) {
  const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, actorUserId)
  if (!isAdmin && !hasPermission(permissions, "MANAGE_ROLES")) {
    return NextResponse.json({ error: "Missing MANAGE_ROLES permission" }, { status: 403 })
  }

  const { data: targetRole, error: roleError } = await supabase
    .from("roles")
    .select("position")
    .eq("id", roleId)
    .eq("server_id", serverId)
    .single()

  if (roleError) {
    if (roleError.code === "PGRST116") {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }
    return NextResponse.json({ error: "Failed to fetch role" }, { status: 500 })
  }

  if (!targetRole) return NextResponse.json({ error: "Role not found" }, { status: 404 })

  if (isAdmin) return null

  const actorMaxPosition = await getActorMaxRolePosition(supabase, serverId, actorUserId)

  if (targetRole.position >= actorMaxPosition) {
    return NextResponse.json({ error: denyMessage }, { status: 403 })
  }

  return null
}

// POST /api/servers/[serverId]/members/[userId]/roles — assign a role to a member
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  try {
    const { serverId, userId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Rate limit: 10 role assignment actions per 5 minutes per moderator
    const rl = await rateLimiter.check(`role_assign:${user.id}`, { limit: 10, windowMs: 5 * 60_000 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many role changes. Please slow down." }, { status: 429 })
    }

    const { roleId } = await req.json()
    if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 })

    const permissionError = await assertRoleMutationAllowed(
      supabase,
      serverId,
      user.id,
      roleId,
      "Cannot assign a role at or above your own highest role"
    )
    if (permissionError) return permissionError

    // Fetch role name for audit log context
    const { data: roleData } = await supabase
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .eq("server_id", serverId)
      .single()

    // Atomic: assign role + audit log in a single transaction via RPC (#582)
    const { error: rpcError } = await supabase.rpc("assign_member_role", {
      p_server_id: serverId,
      p_user_id: userId,
      p_role_id: roleId,
      p_actor_id: user.id,
      p_role_name: roleData?.name ?? null,
    })

    if (rpcError) {
      console.error("[roles] assign_member_role RPC failed", { serverId, userId, roleId, error: rpcError.message })
      return NextResponse.json({ error: "Failed to assign role" }, { status: 500 })
    }

    try {
      invalidatePrefix(`member-roles:${serverId}:${userId}`)
      invalidateServerPermissions(serverId)
    } catch (cacheErr) {
      console.error("[member-roles POST] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[servers/[serverId]/members/[userId]/roles POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/servers/[serverId]/members/[userId]/roles?roleId=... — remove a role
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  try {
    const { serverId, userId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Rate limit: 10 role removal actions per 5 minutes per moderator
    const rl = await rateLimiter.check(`role_remove:${user.id}`, { limit: 10, windowMs: 5 * 60_000 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many role changes. Please slow down." }, { status: 429 })
    }

    const { searchParams } = new URL(req.url)
    const roleId = searchParams.get("roleId")
    if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 })

    const permissionError = await assertRoleMutationAllowed(
      supabase,
      serverId,
      user.id,
      roleId,
      "Cannot remove a role at or above your own highest role"
    )
    if (permissionError) return permissionError

    // Fetch role name for audit log context
    const { data: roleData } = await supabase
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .eq("server_id", serverId)
      .single()

    // Atomic: remove role + audit log in a single transaction via RPC (#582)
    const { error: rpcError } = await supabase.rpc("remove_member_role", {
      p_server_id: serverId,
      p_user_id: userId,
      p_role_id: roleId,
      p_actor_id: user.id,
      p_role_name: roleData?.name ?? null,
    })

    if (rpcError) {
      console.error("[roles] remove_member_role RPC failed", { serverId, userId, roleId, error: rpcError.message })
      return NextResponse.json({ error: "Failed to remove role" }, { status: 500 })
    }

    try {
      invalidatePrefix(`member-roles:${serverId}:${userId}`)
      invalidateServerPermissions(serverId)
    } catch (cacheErr) {
      console.error("[member-roles DELETE] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[servers/[serverId]/members/[userId]/roles DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
