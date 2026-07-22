import { requireServerPermission } from "@/lib/server-auth"
import { PERMISSIONS } from "@vortex/shared"

const { BAN_MEMBERS, ADMINISTRATOR } = PERMISSIONS

export function canModerate(permissions: number): boolean {
  return (permissions & BAN_MEMBERS) !== 0 || (permissions & ADMINISTRATOR) !== 0
}

/**
 * Require that the authenticated user holds BAN_MEMBERS (or ADMINISTRATOR /
 * server-owner) in the given server.  Delegates entirely to the canonical
 * `requireServerPermission` so permission resolution is never duplicated.
 */
export async function requireModerator(serverId: string) {
  return requireServerPermission(serverId, "BAN_MEMBERS")
}
