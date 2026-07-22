import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { PERMISSIONS, hasPermission, getMemberPermissions } from "@/lib/permissions"

export async function requireWorkspaceAccess(supabase: SupabaseClient<Database>, serverId: string, userId: string) {
  const member = await getMemberPermissions(supabase, serverId, userId)
  const canView = member.isOwner || member.isAdmin || hasPermission(member.permissions, "VIEW_CHANNELS")
  const canEdit = member.isOwner || member.isAdmin || hasPermission(member.permissions, "SEND_MESSAGES") || hasPermission(member.permissions, "MANAGE_CHANNELS")
  const canDelete = member.isOwner || member.isAdmin || hasPermission(member.permissions, "MANAGE_MESSAGES") || hasPermission(member.permissions, "MANAGE_CHANNELS")
  return { canView, canEdit, canDelete, permissions: member.permissions, isOwner: member.isOwner, isAdmin: member.isAdmin, permissionBits: PERMISSIONS }
}
