import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { getActorMaxRolePosition } from "@/lib/role-utils"
import { insertAuditLog } from "@/lib/utils/api-helpers"
import { invalidatePrefix } from "@/lib/server-cache"
import { invalidateServerPermissions } from "@/lib/permissions"

// PATCH /api/servers/[serverId]/roles/reorder — reorder roles by position
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Permission check: MANAGE_ROLES required
  const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
  if (!isAdmin && !hasPermission(permissions, "MANAGE_ROLES")) {
    return NextResponse.json({ error: "Missing MANAGE_ROLES permission" }, { status: 403 })
  }

  let body: { roleIds?: string[] }
  try {
    body = await req.json() as { roleIds?: string[] }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { roleIds } = body
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return NextResponse.json({ error: "roleIds must be a non-empty array" }, { status: 400 })
  }

  // Validate no duplicate IDs
  const uniqueIds = new Set(roleIds)
  if (uniqueIds.size !== roleIds.length) {
    return NextResponse.json({ error: "roleIds must not contain duplicates" }, { status: 400 })
  }

  // Fetch all roles for this server to validate the reorder
  const { data: serverRoles, error: fetchError } = await supabase
    .from("roles")
    .select("id, name, position, is_default")
    .eq("server_id", serverId)
    .order("position", { ascending: false })

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!serverRoles || serverRoles.length === 0) {
    return NextResponse.json({ error: "No roles found for this server" }, { status: 404 })
  }

  // Validate that all provided roleIds exist in this server
  const serverRoleMap = new Map(serverRoles.map((r) => [r.id, r]))
  for (const id of roleIds) {
    if (!serverRoleMap.has(id)) {
      return NextResponse.json(
        { error: `Role ${id} not found in this server` },
        { status: 400 }
      )
    }
  }

  // Role hierarchy enforcement: non-admins cannot reorder roles above their own highest position
  if (!isAdmin) {
    const actorMaxPosition = await getActorMaxRolePosition(supabase, serverId, user.id)

    for (const id of roleIds) {
      const role = serverRoleMap.get(id)!
      if (role.position >= actorMaxPosition) {
        return NextResponse.json(
          { error: "Cannot reorder roles at or above your own highest role" },
          { status: 403 }
        )
      }
    }
  }

  // Build the old positions for audit log
  const beforePositions: Record<string, { name: string; position: number }> = {}
  const afterPositions: Record<string, { name: string; position: number }> = {}

  // roleIds is ordered from highest to lowest, so position = (length - index)
  // The default role should remain at position 0; skip it if included
  for (let i = 0; i < roleIds.length; i++) {
    const id = roleIds[i]
    const role = serverRoleMap.get(id)!
    // New position: highest role gets the highest number
    const newPosition = roleIds.length - i

    // Skip updating default role position (it stays at 0)
    if (role.is_default) continue

    beforePositions[id] = { name: role.name, position: role.position }
    afterPositions[id] = { name: role.name, position: newPosition }

    const { error } = await supabase
      .from("roles")
      .update({ position: newPosition })
      .eq("id", id)
      .eq("server_id", serverId)

    if (error) {
      return NextResponse.json({ error: "Failed to reorder roles" }, { status: 500 })
    }
  }

  // Audit log the reorder — insertAuditLog logs errors server-side with full context
  await insertAuditLog(supabase, {
    server_id: serverId,
    actor_id: user.id,
    action: "roles_reordered",
    target_id: serverId,
    target_type: "server",
    changes: {
      before: beforePositions,
      after: afterPositions,
    },
  })

  try {
    invalidatePrefix(`roles:${serverId}`)
    invalidatePrefix(`member-roles:${serverId}`)
    invalidateServerPermissions(serverId)
  } catch (cacheErr) {
    console.error("[roles reorder PATCH] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
  }

  // Fetch and return the updated roles
  const { data: updatedRoles, error: refetchError } = await supabase
    .from("roles")
    .select("*")
    .eq("server_id", serverId)
    .order("position", { ascending: false })

  if (refetchError) {
    return NextResponse.json({ error: refetchError.message }, { status: 500 })
  }

  return NextResponse.json(updatedRoles)
  } catch (err) {
    console.error("[roles reorder PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
