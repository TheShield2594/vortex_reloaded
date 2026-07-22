/**
 * Server-side permission helpers.
 *
 * Use `getMemberPermissions` in API route handlers to resolve the effective
 * bitmask for the calling user without duplicating boilerplate.
 */
import { PERMISSIONS, hasPermission, computePermissions } from "@vortex/shared"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { cached, invalidatePrefix, CACHE_TTLS } from "@/lib/server-cache"

export { PERMISSIONS, hasPermission, computePermissions }
export type { Permission } from "@vortex/shared"

export interface MemberPerms {
  /** True when the user is the server owner (bypasses all permission checks). */
  isOwner: boolean
  /** True when the user has a row in server_members for this server. */
  isMember: boolean
  /** OR-combined bitmask of all roles the member holds. */
  permissions: number
  /** Convenience: true if isOwner OR has ADMINISTRATOR bit. */
  isAdmin: boolean
  /** The server owner's user ID, or null if the server row was not found. */
  ownerId: string | null
  /** Whether the server has member screening enabled. */
  screeningEnabled: boolean
}

/**
 * Fetch the owner of `serverId` and the effective permission bitmask for `userId`
 * (ORed across every role assigned to the member).
 *
 * Returns `{ isOwner: false, isMember: false, permissions: 0, isAdmin: false, ownerId: null, screeningEnabled: false }`
 * when the user is not a member of the server.
 *
 * Throws on infrastructure (DB) failures so callers surface a 500 instead of
 * silently falling back to deny-all.
 */
export async function getMemberPermissions(
  supabase: SupabaseClient<Database>,
  serverId: string,
  userId: string
): Promise<MemberPerms> {
  return cached(
    `perms:${serverId}:${userId}`,
    async () => {
      const [{ data: server, error: serverError }, { data: member, error: memberError }, { data: defaultRole, error: defaultRoleError }] = await Promise.all([
        supabase.from("servers").select("owner_id, screening_enabled").eq("id", serverId).single(),
        supabase
          .from("server_members")
          .select("member_roles(roles(permissions))")
          .eq("server_id", serverId)
          .eq("user_id", userId)
          .maybeSingle(),
        supabase.from("roles").select("permissions").eq("server_id", serverId).eq("is_default", true).maybeSingle(),
      ])

      if (serverError) throw new Error(`Failed to fetch server: ${serverError.message}`)
      if (memberError) throw new Error(`Failed to fetch member: ${memberError.message}`)
      if (defaultRoleError) throw new Error(`Failed to fetch default role: ${defaultRoleError.message}`)

      const ownerId: string | null = server?.owner_id ?? null
      const isOwner = ownerId === userId
      const isMember = member !== null || isOwner

      interface MemberRoleJoin {
        roles: { permissions: number } | null
      }
      const memberWithRoles = member as { member_roles?: MemberRoleJoin[] } | null
      const rawPerms: number[] =
        memberWithRoles?.member_roles?.flatMap((mr) =>
          mr.roles?.permissions != null ? [mr.roles.permissions] : []
        ) ?? []

      // Only include default role permissions for actual members — non-members
      // must not inherit any server permissions from the @everyone role.
      if (isMember && defaultRole?.permissions != null) rawPerms.push(defaultRole.permissions)

      const permissions = computePermissions(rawPerms)
      const isAdmin = isOwner || !!(permissions & PERMISSIONS.ADMINISTRATOR)
      const screeningEnabled: boolean = !!server?.screening_enabled

      return { isOwner, isMember, permissions, isAdmin, ownerId, screeningEnabled }
    },
    CACHE_TTLS.MEMBER_PERMISSIONS,
  )
}

/**
 * Resolve a member's effective permissions for a specific channel by applying
 * role-level channel overwrite rows (deny first, then allow).
 */
export async function getChannelPermissions(
  supabase: SupabaseClient<Database>,
  serverId: string,
  channelId: string,
  userId: string
): Promise<MemberPerms> {
  return cached(
    `chan-perms:${serverId}:${channelId}:${userId}`,
    async () => {
      const [memberPerms, memberRolesResult, defaultRoleResult, overwritesResult] = await Promise.all([
        getMemberPermissions(supabase, serverId, userId),
        supabase.from("member_roles").select("role_id").eq("server_id", serverId).eq("user_id", userId),
        supabase.from("roles").select("id").eq("server_id", serverId).eq("is_default", true).maybeSingle(),
        supabase.from("channel_permissions").select("role_id, allow_permissions, deny_permissions").eq("channel_id", channelId),
      ])

      if (memberRolesResult.error) throw new Error(`Failed to fetch member roles: ${memberRolesResult.error.message}`)
      if (defaultRoleResult.error) throw new Error(`Failed to fetch default role: ${defaultRoleResult.error.message}`)
      if (overwritesResult.error) throw new Error(`Failed to fetch channel overrides: ${overwritesResult.error.message}`)

      if (memberPerms.isOwner || memberPerms.isAdmin) {
        return memberPerms
      }

      const roleIds = new Set((memberRolesResult.data ?? []).map((r) => r.role_id))
      const defaultRoleId = defaultRoleResult.data?.id ?? null
      if (defaultRoleId) roleIds.add(defaultRoleId)
      if (roleIds.size === 0) return memberPerms

      const relevantOverwrites = (overwritesResult.data ?? []).filter((row) => roleIds.has(row.role_id))

      const denyMask = relevantOverwrites.reduce((acc, row) => acc | (row.deny_permissions ?? 0), 0)
      const allowMask = relevantOverwrites.reduce((acc, row) => acc | (row.allow_permissions ?? 0), 0)
      const permissions = (memberPerms.permissions & ~denyMask) | allowMask

      return { ...memberPerms, permissions }
    },
    CACHE_TTLS.MEMBER_PERMISSIONS,
  )
}

/**
 * Batch-resolve channel permissions for multiple channels in a single server.
 *
 * Instead of calling getChannelPermissions() per channel (N+1 pattern), this
 * function fetches the member's roles, default role, and ALL channel overwrites
 * in just 3 queries, then computes permissions in-memory.
 *
 * Returns a Map<channelId, MemberPerms>.
 */
export async function getBatchChannelPermissions(
  supabase: SupabaseClient<Database>,
  serverId: string,
  channelIds: string[],
  userId: string,
): Promise<Map<string, MemberPerms>> {
  if (channelIds.length === 0) return new Map()

  // Single call to get member-level permissions (already cached with 30s TTL)
  const memberPerms = await getMemberPermissions(supabase, serverId, userId)

  // If the user is owner/admin, they have full permissions on all channels
  if (memberPerms.isOwner || memberPerms.isAdmin) {
    const result = new Map<string, MemberPerms>()
    for (const channelId of channelIds) {
      result.set(channelId, memberPerms)
    }
    return result
  }

  // Not a member → no permissions on any channel
  if (!memberPerms.isMember) return new Map()

  // Batch-fetch member role IDs and default role in parallel
  const [memberRolesResult, defaultRoleResult, overwritesResult] = await Promise.all([
    supabase.from("member_roles").select("role_id").eq("server_id", serverId).eq("user_id", userId),
    supabase.from("roles").select("id").eq("server_id", serverId).eq("is_default", true).maybeSingle(),
    supabase.from("channel_permissions").select("channel_id, role_id, allow_permissions, deny_permissions").in("channel_id", channelIds),
  ])

  if (memberRolesResult.error) throw new Error(`Failed to fetch member roles: ${memberRolesResult.error.message}`)
  if (defaultRoleResult.error) throw new Error(`Failed to fetch default role: ${defaultRoleResult.error.message}`)
  if (overwritesResult.error) throw new Error(`Failed to fetch channel overwrites: ${overwritesResult.error.message}`)

  const roleIds = new Set((memberRolesResult.data ?? []).map((r) => r.role_id))
  const defaultRoleId = defaultRoleResult.data?.id ?? null
  if (defaultRoleId) roleIds.add(defaultRoleId)

  // Group overwrites by channel_id
  const overwritesByChannel = new Map<string, Array<{ role_id: string; allow_permissions: number | null; deny_permissions: number | null }>>()
  for (const row of overwritesResult.data ?? []) {
    if (!roleIds.has(row.role_id)) continue
    let list = overwritesByChannel.get(row.channel_id)
    if (!list) {
      list = []
      overwritesByChannel.set(row.channel_id, list)
    }
    list.push(row)
  }

  // Compute per-channel permissions in memory
  const result = new Map<string, MemberPerms>()
  for (const channelId of channelIds) {
    const overwrites = overwritesByChannel.get(channelId)
    if (!overwrites || overwrites.length === 0 || roleIds.size === 0) {
      result.set(channelId, memberPerms)
      continue
    }

    const denyMask = overwrites.reduce((acc, row) => acc | (row.deny_permissions ?? 0), 0)
    const allowMask = overwrites.reduce((acc, row) => acc | (row.allow_permissions ?? 0), 0)
    const permissions = (memberPerms.permissions & ~denyMask) | allowMask

    result.set(channelId, { ...memberPerms, permissions })
  }

  return result
}

/** Invalidate all cached permissions for a server (after role/member changes). */
export function invalidateServerPermissions(serverId: string): void {
  invalidatePrefix(`perms:${serverId}`)
  invalidatePrefix(`chan-perms:${serverId}:`)
}

/** Invalidate cached channel permissions (after channel permission overwrite changes). */
export function invalidateChannelPermissions(serverId: string, channelId: string): void {
  invalidatePrefix(`chan-perms:${serverId}:${channelId}:`)
}
