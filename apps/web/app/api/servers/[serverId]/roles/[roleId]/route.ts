import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission, invalidateServerPermissions } from "@/lib/permissions"
import { getActorMaxRolePosition } from "@/lib/role-utils"
import { invalidatePrefix } from "@/lib/server-cache"
import type { Json } from "@/types/database"

// PATCH /api/servers/[serverId]/roles/[roleId] — update a role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; roleId: string }> }
) {
  try {
  const { serverId, roleId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Permission check: MANAGE_ROLES required
  const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
  if (!isAdmin && !hasPermission(permissions, "MANAGE_ROLES")) {
    return NextResponse.json({ error: "Missing MANAGE_ROLES permission" }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Fetch the target role
  const { data: targetRole, error: roleError } = await supabase
    .from("roles")
    .select("*")
    .eq("id", roleId)
    .eq("server_id", serverId)
    .single()

  if (roleError || !targetRole) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 })
  }

  // Cannot edit the @everyone default role's position
  if (targetRole.is_default && body.position !== undefined) {
    return NextResponse.json(
      { error: "Cannot change the position of the default role" },
      { status: 400 }
    )
  }

  // Role hierarchy enforcement: non-admins cannot edit roles at or above their own highest role
  if (!isAdmin) {
    const actorMaxPosition = await getActorMaxRolePosition(supabase, serverId, user.id)
    if (targetRole.position >= actorMaxPosition) {
      return NextResponse.json(
        { error: "Cannot edit a role at or above your own highest role" },
        { status: 403 }
      )
    }
  }

  // Build update payload from allowed fields with explicit type validation
  const updates: Record<string, string | number | boolean> = {}
  if (body.name !== undefined) {
    if (typeof body.name !== "string") return NextResponse.json({ error: "name must be a string" }, { status: 400 })
    updates.name = body.name.trim()
  }
  if (body.color !== undefined) {
    if (typeof body.color !== "string") return NextResponse.json({ error: "color must be a string" }, { status: 400 })
    updates.color = body.color
  }
  if (body.permissions !== undefined) {
    if (typeof body.permissions !== "number" || !Number.isFinite(body.permissions)) return NextResponse.json({ error: "permissions must be a number" }, { status: 400 })
    updates.permissions = body.permissions
  }
  if (body.is_hoisted !== undefined) {
    if (typeof body.is_hoisted !== "boolean") return NextResponse.json({ error: "is_hoisted must be a boolean" }, { status: 400 })
    updates.is_hoisted = body.is_hoisted
  }
  if (body.mentionable !== undefined) {
    if (typeof body.mentionable !== "boolean") return NextResponse.json({ error: "mentionable must be a boolean" }, { status: 400 })
    updates.mentionable = body.mentionable
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { data: updatedRole, error: updateError } = await supabase
    .from("roles")
    .update(updates)
    .eq("id", roleId)
    .eq("server_id", serverId)
    .select()
    .single()

  if (updateError || !updatedRole) {
    if (updateError) console.error("[roles PATCH] update failed", { serverId, roleId, userId: user.id, message: updateError.message })
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 })
  }

  // Build before/after diff for audit log
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const key of Object.keys(updates)) {
    before[key] = targetRole[key as keyof typeof targetRole]
    after[key] = updatedRole[key as keyof typeof updatedRole]
  }

  const { error: auditErr } = await supabase.from("audit_logs").insert({
    server_id: serverId,
    actor_id: user.id,
    action: "role_updated",
    target_id: roleId,
    target_type: "role",
    changes: {
      role_name: targetRole.name,
      before,
      after,
    } as unknown as Json,
  })
  if (auditErr) {
    console.error("[roles] Audit log insert failed for role_updated", { serverId, roleId, error: auditErr.message })
    return NextResponse.json({ error: "Failed to record audit log" }, { status: 500 })
  }

  try {
    invalidatePrefix(`roles:${serverId}`)
    invalidatePrefix(`member-roles:${serverId}`)
    invalidateServerPermissions(serverId)
  } catch (cacheErr) {
    console.error("[roles PATCH] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
  }

  return NextResponse.json(updatedRole)
  } catch (err) {
    console.error("[servers/[serverId]/roles/[roleId] PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/servers/[serverId]/roles/[roleId] — delete a role
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string; roleId: string }> }
) {
  try {
    const { serverId, roleId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Permission check: MANAGE_ROLES required
    const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin && !hasPermission(permissions, "MANAGE_ROLES")) {
      return NextResponse.json({ error: "Missing MANAGE_ROLES permission" }, { status: 403 })
    }

    // Fetch the target role
    const { data: targetRole, error: roleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .eq("server_id", serverId)
      .single()

    if (roleError || !targetRole) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }

    // Cannot delete the @everyone default role
    if (targetRole.is_default) {
      return NextResponse.json(
        { error: "Cannot delete the default role" },
        { status: 400 }
      )
    }

    // Role hierarchy enforcement: non-admins cannot delete roles at or above their own highest role
    if (!isAdmin) {
      const actorMaxPosition = await getActorMaxRolePosition(supabase, serverId, user.id)
      if (targetRole.position >= actorMaxPosition) {
        return NextResponse.json(
          { error: "Cannot delete a role at or above your own highest role" },
          { status: 403 }
        )
      }
    }

    const { error: deleteError } = await supabase
      .from("roles")
      .delete()
      .eq("id", roleId)
      .eq("server_id", serverId)

    if (deleteError) {
      console.error("[roles DELETE] DB error:", { serverId, roleId, userId: user.id, err: deleteError.message })
      const { error: failAuditErr } = await supabase.from("audit_logs").insert({
        server_id: serverId,
        actor_id: user.id,
        action: "role_delete_failed",
        target_id: roleId,
        target_type: "role",
        changes: {
          role_name: targetRole.name,
          error: deleteError.message,
        } as unknown as Json,
      })
      if (failAuditErr) {
        console.error("[roles DELETE] Audit log insert failed for role_delete_failed", { serverId, roleId, error: failAuditErr.message })
      }
      return NextResponse.json({ error: "Failed to delete role" }, { status: 500 })
    }

    // Audit log the deletion
    const { error: deleteAuditErr } = await supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: user.id,
      action: "role_deleted",
      target_id: roleId,
      target_type: "role",
      changes: {
        role_name: targetRole.name,
        role_color: targetRole.color,
        role_position: targetRole.position,
        role_permissions: targetRole.permissions,
      } as unknown as Json,
    })
    if (deleteAuditErr) {
      console.error("[roles] Audit log insert failed for role_deleted", { serverId, roleId, error: deleteAuditErr.message })
      return NextResponse.json({ error: "Failed to record audit log" }, { status: 500 })
    }

    try {
      invalidatePrefix(`roles:${serverId}`)
      invalidatePrefix(`member-roles:${serverId}`)
      invalidateServerPermissions(serverId)
    } catch (cacheErr) {
      console.error("[roles DELETE] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
    }

    return new NextResponse(null, { status: 204 })

  } catch (err) {
    console.error("[servers/[serverId]/roles/[roleId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
