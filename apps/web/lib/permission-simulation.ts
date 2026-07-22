/**
 * Permission simulation and risk-analysis helpers for admin safety tooling.
 *
 * All computation is pure (no I/O) so it can be used in both API routes and
 * tests without a database connection.
 */
import { PERMISSIONS, computePermissions, hasPermission, type Permission } from "@vortex/shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoleSnapshot {
  id: string
  name: string
  permissions: number
  is_default: boolean
  position: number
  color: string
}

export interface ChannelOverwriteSnapshot {
  role_id: string
  allow_permissions: number
  deny_permissions: number
}

export interface SimulationResult {
  /** Effective server-level permission bitmask (OR of all assigned roles). */
  serverPermissions: number
  /** Effective channel-level permission bitmask after applying overwrites. */
  channelPermissions: number
  /** Whether the subject is treated as an administrator (bypasses all checks). */
  isAdmin: boolean
  /** Human-readable list of granted permissions at the server level. */
  grantedServerPerms: Permission[]
  /** Human-readable list of granted permissions at the channel level. */
  grantedChannelPerms: Permission[]
  /** Permissions explicitly denied by a channel overwrite. */
  deniedChannelPerms: Permission[]
  /** Permissions explicitly allowed by a channel overwrite. */
  allowedChannelPerms: Permission[]
}

export type RiskSeverity = "critical" | "high" | "medium" | "low"

export interface PermissionRisk {
  severity: RiskSeverity
  code: string
  message: string
  /** Which permission keys are involved. */
  involvedPerms: Permission[]
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const ALL_PERM_KEYS = Object.keys(PERMISSIONS) as Permission[]

/**
 * Compute the effective permissions a subject (role set) would have on a
 * server plus optionally in a specific channel.
 *
 * @param assignedRoles  All roles currently assigned to the subject.
 * @param defaultRole    The @everyone default role for the server.
 * @param overwrites     Channel-level overwrite rows applicable to this subject
 *                       (i.e. only rows whose role_id appears in assignedRoles
 *                       or is the defaultRole id).
 * @param isOwner        True when the subject is the server owner.
 */
export function simulatePermissions(
  assignedRoles: RoleSnapshot[],
  defaultRole: RoleSnapshot | null,
  overwrites: ChannelOverwriteSnapshot[],
  isOwner: boolean
): SimulationResult {
  // Collect unique roles (include default @everyone).
  const allRoles = [...assignedRoles]
  if (defaultRole && !allRoles.some((r) => r.id === defaultRole.id)) {
    allRoles.push(defaultRole)
  }

  // Server-level: OR all role bitmasks.
  const serverPermissions = isOwner
    ? Object.values(PERMISSIONS).reduce((a, b) => a | b, 0)
    : computePermissions(allRoles.map((r) => r.permissions))

  const isAdmin = isOwner || !!(serverPermissions & PERMISSIONS.ADMINISTRATOR)

  // Admins bypass channel overwrites.
  let channelPermissions = serverPermissions
  let denyMask = 0
  let allowMask = 0

  if (!isAdmin && overwrites.length > 0) {
    denyMask = overwrites.reduce((acc, row) => acc | (row.deny_permissions ?? 0), 0)
    allowMask = overwrites.reduce((acc, row) => acc | (row.allow_permissions ?? 0), 0)
    channelPermissions = (serverPermissions & ~denyMask) | allowMask
  }

  const grantedServerPerms = ALL_PERM_KEYS.filter((k) =>
    isAdmin ? true : !!(serverPermissions & PERMISSIONS[k])
  )
  const grantedChannelPerms = ALL_PERM_KEYS.filter((k) =>
    isAdmin ? true : !!(channelPermissions & PERMISSIONS[k])
  )
  const deniedChannelPerms = isAdmin
    ? []
    : ALL_PERM_KEYS.filter((k) => !!(denyMask & PERMISSIONS[k]))
  const allowedChannelPerms = isAdmin
    ? []
    : ALL_PERM_KEYS.filter((k) => !!(allowMask & PERMISSIONS[k]))

  return {
    serverPermissions,
    channelPermissions,
    isAdmin,
    grantedServerPerms,
    grantedChannelPerms,
    deniedChannelPerms,
    allowedChannelPerms,
  }
}

// ---------------------------------------------------------------------------
// Risk / conflict detection
// ---------------------------------------------------------------------------

/**
 * Analyse a role's (proposed) permission bitmask and return any risks that
 * should be surfaced to the admin before saving.
 */
export function detectRolePermissionRisks(
  proposedPermissions: number,
  previousPermissions: number,
  isDefaultRole: boolean
): PermissionRisk[] {
  const risks: PermissionRisk[] = []

  // ADMINISTRATOR: most dangerous escalation
  if (
    !!(proposedPermissions & PERMISSIONS.ADMINISTRATOR) &&
    !(previousPermissions & PERMISSIONS.ADMINISTRATOR)
  ) {
    risks.push({
      severity: "critical",
      code: "ADMINISTRATOR_GRANTED",
      message:
        "Granting ADMINISTRATOR bypasses every permission check, including channel overwrites. Only trust fully-vetted accounts with this permission.",
      involvedPerms: ["ADMINISTRATOR"],
    })
  }

  // BAN + KICK without MODERATE_MEMBERS — common misconfiguration
  const hasBan = !!(proposedPermissions & PERMISSIONS.BAN_MEMBERS)
  const hasKick = !!(proposedPermissions & PERMISSIONS.KICK_MEMBERS)
  const hasModerate = !!(proposedPermissions & PERMISSIONS.MODERATE_MEMBERS)
  if ((hasBan || hasKick) && !hasModerate) {
    risks.push({
      severity: "medium",
      code: "BAN_KICK_WITHOUT_MODERATE",
      message:
        "This role can ban or kick members but cannot time them out (MODERATE_MEMBERS is not set). Consider whether this is intentional.",
      involvedPerms: hasBan && hasKick ? ["BAN_MEMBERS", "KICK_MEMBERS"] : hasBan ? ["BAN_MEMBERS"] : ["KICK_MEMBERS"],
    })
  }

  // MANAGE_ROLES without ADMINISTRATOR — actor can create/edit roles below themselves
  const hasManageRoles = !!(proposedPermissions & PERMISSIONS.MANAGE_ROLES)
  const hasAdmin = !!(proposedPermissions & PERMISSIONS.ADMINISTRATOR)
  if (hasManageRoles && !hasAdmin) {
    risks.push({
      severity: "high",
      code: "MANAGE_ROLES_ESCALATION",
      message:
        "MANAGE_ROLES lets members create new roles and assign them. Without ADMINISTRATOR the escalation is limited to roles below theirs, but it is still a powerful permission.",
      involvedPerms: ["MANAGE_ROLES"],
    })
  }

  // MENTION_EVERYONE — spam/harassment vector
  if (!!(proposedPermissions & PERMISSIONS.MENTION_EVERYONE) && !(previousPermissions & PERMISSIONS.MENTION_EVERYONE)) {
    risks.push({
      severity: "high",
      code: "MENTION_EVERYONE_GRANTED",
      message:
        "This role can now ping @everyone and @here, which notifies all server members. Ensure this is intentional.",
      involvedPerms: ["MENTION_EVERYONE"],
    })
  }

  // Default role: removing VIEW_CHANNELS locks all members out
  if (isDefaultRole && !(proposedPermissions & PERMISSIONS.VIEW_CHANNELS)) {
    risks.push({
      severity: "critical",
      code: "DEFAULT_ROLE_LOCKED_OUT",
      message:
        "Removing VIEW_CHANNELS from @everyone will prevent all members from seeing any channel unless they have another role that grants it.",
      involvedPerms: ["VIEW_CHANNELS"],
    })
  }

  return risks
}

/**
 * Analyse channel overwrite changes and return any risks before saving.
 *
 * @param roleId          The role being edited.
 * @param isDefaultRole   True when the role is @everyone.
 * @param proposedAllow   New allow bitmask.
 * @param proposedDeny    New deny bitmask.
 * @param previousAllow   Previous allow bitmask (0 for new overwrite).
 * @param previousDeny    Previous deny bitmask (0 for new overwrite).
 */
export function detectChannelOverwriteRisks(
  isDefaultRole: boolean,
  proposedAllow: number,
  proposedDeny: number,
  previousAllow: number,
  previousDeny: number
): PermissionRisk[] {
  const risks: PermissionRisk[] = []

  // Deny VIEW_CHANNELS on @everyone — effectively hides the channel from everyone
  if (
    isDefaultRole &&
    !!(proposedDeny & PERMISSIONS.VIEW_CHANNELS) &&
    !(previousDeny & PERMISSIONS.VIEW_CHANNELS)
  ) {
    risks.push({
      severity: "high",
      code: "DEFAULT_ROLE_VIEW_DENIED",
      message:
        "Denying VIEW_CHANNELS on @everyone hides this channel from all members who do not have another role with an explicit allow overwrite.",
      involvedPerms: ["VIEW_CHANNELS"],
    })
  }

  // Deny SEND_MESSAGES on @everyone — read-only channel
  if (
    isDefaultRole &&
    !!(proposedDeny & PERMISSIONS.SEND_MESSAGES) &&
    !(previousDeny & PERMISSIONS.SEND_MESSAGES)
  ) {
    risks.push({
      severity: "medium",
      code: "DEFAULT_ROLE_SEND_DENIED",
      message:
        "Denying SEND_MESSAGES on @everyone makes this a read-only channel for most members. Confirm this is the intended behaviour.",
      involvedPerms: ["SEND_MESSAGES"],
    })
  }

  // Conflicting allow + deny for the same bit (shouldn't happen via UI but guard anyway)
  const conflict = proposedAllow & proposedDeny
  if (conflict) {
    const conflicted = ALL_PERM_KEYS.filter((k) => !!(conflict & PERMISSIONS[k]))
    if (conflicted.length > 0) {
      risks.push({
        severity: "medium",
        code: "ALLOW_DENY_CONFLICT",
        message: `The same permission bits are set in both allow and deny (${conflicted.join(", ")}). Deny takes precedence in most implementations.`,
        involvedPerms: conflicted,
      })
    }
  }

  return risks
}

/**
 * Describe a before/after permission bitmask difference as a human-readable
 * list of added and removed permission keys.
 */
export function diffPermissions(before: number, after: number): { added: Permission[]; removed: Permission[] } {
  const added = ALL_PERM_KEYS.filter((k) => !(before & PERMISSIONS[k]) && !!(after & PERMISSIONS[k]))
  const removed = ALL_PERM_KEYS.filter((k) => !!(before & PERMISSIONS[k]) && !(after & PERMISSIONS[k]))
  return { added, removed }
}
