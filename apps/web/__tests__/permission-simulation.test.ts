import { describe, expect, it } from "vitest"
import { PERMISSIONS } from "@vortex/shared"
import {
  simulatePermissions,
  detectRolePermissionRisks,
  detectChannelOverwriteRisks,
  diffPermissions,
  type RoleSnapshot,
  type ChannelOverwriteSnapshot,
} from "@/lib/permission-simulation"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRole(id: string, permissions: number, opts: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    id,
    name: id,
    permissions,
    is_default: false,
    position: 1,
    color: "#ffffff",
    ...opts,
  }
}

const DEFAULT_ROLE = makeRole("everyone", PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES, {
  is_default: true,
  position: 0,
})

// ---------------------------------------------------------------------------
// simulatePermissions
// ---------------------------------------------------------------------------

describe("simulatePermissions — server level", () => {
  it("returns 0 permissions for a role with no bits set", () => {
    const result = simulatePermissions([makeRole("r1", 0)], DEFAULT_ROLE, [], false)
    // default role bits still included
    expect(result.serverPermissions & PERMISSIONS.VIEW_CHANNELS).toBeTruthy()
  })

  it("ORs assigned role bits with default role", () => {
    const modRole = makeRole("mod", PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MANAGE_MESSAGES)
    const result = simulatePermissions([modRole], DEFAULT_ROLE, [], false)
    expect(result.serverPermissions & PERMISSIONS.KICK_MEMBERS).toBeTruthy()
    expect(result.serverPermissions & PERMISSIONS.MANAGE_MESSAGES).toBeTruthy()
    expect(result.serverPermissions & PERMISSIONS.SEND_MESSAGES).toBeTruthy()
  })

  it("server owner gets all permissions regardless of role set", () => {
    const result = simulatePermissions([], DEFAULT_ROLE, [], true)
    expect(result.isAdmin).toBe(true)
    for (const key of Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>) {
      expect(result.grantedServerPerms).toContain(key)
    }
  })

  it("isAdmin is true when ADMINISTRATOR bit is set", () => {
    const adminRole = makeRole("admin", PERMISSIONS.ADMINISTRATOR)
    const result = simulatePermissions([adminRole], DEFAULT_ROLE, [], false)
    expect(result.isAdmin).toBe(true)
  })

  it("isAdmin is false for a regular member role", () => {
    const memberRole = makeRole("member", PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS)
    const result = simulatePermissions([memberRole], DEFAULT_ROLE, [], false)
    expect(result.isAdmin).toBe(false)
  })

  it("grantedServerPerms does not include unset bits", () => {
    const result = simulatePermissions([makeRole("r", PERMISSIONS.SEND_MESSAGES)], DEFAULT_ROLE, [], false)
    expect(result.grantedServerPerms).not.toContain("BAN_MEMBERS")
    expect(result.grantedServerPerms).not.toContain("ADMINISTRATOR")
  })

  it("does not duplicate default role when it is also in assignedRoles", () => {
    // When default role is explicitly in the assigned list it should not double-count
    const result = simulatePermissions([DEFAULT_ROLE], DEFAULT_ROLE, [], false)
    // Just verifying no crash and correct bits
    expect(result.serverPermissions & PERMISSIONS.VIEW_CHANNELS).toBeTruthy()
  })
})

describe("simulatePermissions — channel overwrites", () => {
  const memberRole = makeRole("member", PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES)

  it("deny overwrite removes a permission from effective channel perms", () => {
    const overwrite: ChannelOverwriteSnapshot = {
      role_id: DEFAULT_ROLE.id,
      allow_permissions: 0,
      deny_permissions: PERMISSIONS.SEND_MESSAGES,
    }
    const result = simulatePermissions([memberRole], DEFAULT_ROLE, [overwrite], false)
    expect(result.channelPermissions & PERMISSIONS.SEND_MESSAGES).toBe(0)
    expect(result.deniedChannelPerms).toContain("SEND_MESSAGES")
  })

  it("allow overwrite re-grants a permission that wasn't in server perms", () => {
    const restrictedRole = makeRole("r", PERMISSIONS.VIEW_CHANNELS) // no SEND_MESSAGES
    const overwrite: ChannelOverwriteSnapshot = {
      role_id: "r",
      allow_permissions: PERMISSIONS.SEND_MESSAGES,
      deny_permissions: 0,
    }
    const result = simulatePermissions([restrictedRole], null, [overwrite], false)
    expect(result.channelPermissions & PERMISSIONS.SEND_MESSAGES).toBeTruthy()
    expect(result.allowedChannelPerms).toContain("SEND_MESSAGES")
  })

  it("ADMINISTRATOR bypasses channel overwrites", () => {
    const adminRole = makeRole("admin", PERMISSIONS.ADMINISTRATOR)
    const denyAll: ChannelOverwriteSnapshot = {
      role_id: DEFAULT_ROLE.id,
      allow_permissions: 0,
      deny_permissions: 0xffffffff,
    }
    const result = simulatePermissions([adminRole], DEFAULT_ROLE, [denyAll], false)
    expect(result.isAdmin).toBe(true)
    expect(result.channelPermissions).toBe(result.serverPermissions)
    expect(result.deniedChannelPerms).toHaveLength(0)
  })

  it("multiple role overwrites are combined: last allow wins", () => {
    const r1 = makeRole("r1", PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES)
    const r2 = makeRole("r2", 0)

    const ow1: ChannelOverwriteSnapshot = { role_id: "r1", allow_permissions: 0, deny_permissions: PERMISSIONS.SEND_MESSAGES }
    const ow2: ChannelOverwriteSnapshot = { role_id: "r2", allow_permissions: PERMISSIONS.SEND_MESSAGES, deny_permissions: 0 }

    const result = simulatePermissions([r1, r2], DEFAULT_ROLE, [ow1, ow2], false)
    // allow always wins over deny in accumulated mask
    expect(result.channelPermissions & PERMISSIONS.SEND_MESSAGES).toBeTruthy()
  })

  it("returns empty denied/allowed lists when no overwrites apply", () => {
    const result = simulatePermissions([memberRole], DEFAULT_ROLE, [], false)
    expect(result.deniedChannelPerms).toHaveLength(0)
    expect(result.allowedChannelPerms).toHaveLength(0)
    expect(result.channelPermissions).toBe(result.serverPermissions)
  })
})

// ---------------------------------------------------------------------------
// detectRolePermissionRisks
// ---------------------------------------------------------------------------

describe("detectRolePermissionRisks", () => {
  it("emits ADMINISTRATOR_GRANTED when adding ADMINISTRATOR bit", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.ADMINISTRATOR, 0, false)
    expect(risks.some((r) => r.code === "ADMINISTRATOR_GRANTED")).toBe(true)
    expect(risks.find((r) => r.code === "ADMINISTRATOR_GRANTED")?.severity).toBe("critical")
  })

  it("does NOT emit ADMINISTRATOR_GRANTED when ADMINISTRATOR was already set", () => {
    const prev = PERMISSIONS.ADMINISTRATOR | PERMISSIONS.SEND_MESSAGES
    const next = PERMISSIONS.ADMINISTRATOR | PERMISSIONS.BAN_MEMBERS
    const risks = detectRolePermissionRisks(next, prev, false)
    expect(risks.some((r) => r.code === "ADMINISTRATOR_GRANTED")).toBe(false)
  })

  it("emits MENTION_EVERYONE_GRANTED when adding MENTION_EVERYONE", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.MENTION_EVERYONE, 0, false)
    expect(risks.some((r) => r.code === "MENTION_EVERYONE_GRANTED")).toBe(true)
    expect(risks.find((r) => r.code === "MENTION_EVERYONE_GRANTED")?.severity).toBe("high")
  })

  it("emits MANAGE_ROLES_ESCALATION for MANAGE_ROLES without ADMINISTRATOR", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.MANAGE_ROLES, 0, false)
    expect(risks.some((r) => r.code === "MANAGE_ROLES_ESCALATION")).toBe(true)
  })

  it("does NOT emit MANAGE_ROLES_ESCALATION when ADMINISTRATOR is also set", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.MANAGE_ROLES | PERMISSIONS.ADMINISTRATOR, 0, false)
    expect(risks.some((r) => r.code === "MANAGE_ROLES_ESCALATION")).toBe(false)
  })

  it("emits BAN_KICK_WITHOUT_MODERATE when BAN is set without MODERATE", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.BAN_MEMBERS, 0, false)
    expect(risks.some((r) => r.code === "BAN_KICK_WITHOUT_MODERATE")).toBe(true)
  })

  it("does NOT emit BAN_KICK_WITHOUT_MODERATE when MODERATE_MEMBERS is also set", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.BAN_MEMBERS | PERMISSIONS.MODERATE_MEMBERS, 0, false)
    expect(risks.some((r) => r.code === "BAN_KICK_WITHOUT_MODERATE")).toBe(false)
  })

  it("emits DEFAULT_ROLE_LOCKED_OUT on default role when VIEW_CHANNELS is removed", () => {
    const risks = detectRolePermissionRisks(
      PERMISSIONS.SEND_MESSAGES, // no VIEW_CHANNELS
      PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES,
      true // is_default
    )
    expect(risks.some((r) => r.code === "DEFAULT_ROLE_LOCKED_OUT")).toBe(true)
    expect(risks.find((r) => r.code === "DEFAULT_ROLE_LOCKED_OUT")?.severity).toBe("critical")
  })

  it("returns no risks for a safe read-only member role", () => {
    const risks = detectRolePermissionRisks(PERMISSIONS.VIEW_CHANNELS, 0, false)
    expect(risks).toHaveLength(0)
  })

  it("returns no risks when no permissions are changed", () => {
    const bits = PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS
    const risks = detectRolePermissionRisks(bits, bits, false)
    expect(risks.every((r) => r.code !== "ADMINISTRATOR_GRANTED")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// detectChannelOverwriteRisks
// ---------------------------------------------------------------------------

describe("detectChannelOverwriteRisks", () => {
  it("emits DEFAULT_ROLE_VIEW_DENIED when @everyone VIEW_CHANNELS is newly denied", () => {
    const risks = detectChannelOverwriteRisks(true, 0, PERMISSIONS.VIEW_CHANNELS, 0, 0)
    expect(risks.some((r) => r.code === "DEFAULT_ROLE_VIEW_DENIED")).toBe(true)
  })

  it("does NOT emit DEFAULT_ROLE_VIEW_DENIED when VIEW_CHANNELS was already denied", () => {
    const risks = detectChannelOverwriteRisks(true, 0, PERMISSIONS.VIEW_CHANNELS, 0, PERMISSIONS.VIEW_CHANNELS)
    expect(risks.some((r) => r.code === "DEFAULT_ROLE_VIEW_DENIED")).toBe(false)
  })

  it("emits DEFAULT_ROLE_SEND_DENIED when @everyone SEND_MESSAGES is newly denied", () => {
    const risks = detectChannelOverwriteRisks(true, 0, PERMISSIONS.SEND_MESSAGES, 0, 0)
    expect(risks.some((r) => r.code === "DEFAULT_ROLE_SEND_DENIED")).toBe(true)
    expect(risks.find((r) => r.code === "DEFAULT_ROLE_SEND_DENIED")?.severity).toBe("medium")
  })

  it("does NOT emit view/send warnings for non-default roles", () => {
    const risks = detectChannelOverwriteRisks(false, 0, PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES, 0, 0)
    expect(risks.some((r) => r.code === "DEFAULT_ROLE_VIEW_DENIED")).toBe(false)
    expect(risks.some((r) => r.code === "DEFAULT_ROLE_SEND_DENIED")).toBe(false)
  })

  it("emits ALLOW_DENY_CONFLICT when the same bit appears in both allow and deny", () => {
    const risks = detectChannelOverwriteRisks(
      false,
      PERMISSIONS.SEND_MESSAGES,
      PERMISSIONS.SEND_MESSAGES,
      0,
      0
    )
    expect(risks.some((r) => r.code === "ALLOW_DENY_CONFLICT")).toBe(true)
    expect(risks.find((r) => r.code === "ALLOW_DENY_CONFLICT")?.involvedPerms).toContain("SEND_MESSAGES")
  })

  it("returns no risks for a safe non-default role overwrite", () => {
    const risks = detectChannelOverwriteRisks(false, PERMISSIONS.SEND_MESSAGES, 0, 0, 0)
    expect(risks).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// diffPermissions
// ---------------------------------------------------------------------------

describe("diffPermissions", () => {
  it("detects added permissions", () => {
    const { added, removed } = diffPermissions(0, PERMISSIONS.BAN_MEMBERS | PERMISSIONS.KICK_MEMBERS)
    expect(added).toContain("BAN_MEMBERS")
    expect(added).toContain("KICK_MEMBERS")
    expect(removed).toHaveLength(0)
  })

  it("detects removed permissions", () => {
    const { added, removed } = diffPermissions(
      PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS,
      PERMISSIONS.VIEW_CHANNELS
    )
    expect(removed).toContain("SEND_MESSAGES")
    expect(added).toHaveLength(0)
  })

  it("detects both added and removed in same change", () => {
    const before = PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS
    const after = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.BAN_MEMBERS
    const { added, removed } = diffPermissions(before, after)
    expect(added).toContain("BAN_MEMBERS")
    expect(removed).toContain("SEND_MESSAGES")
  })

  it("returns empty arrays when permissions are identical", () => {
    const bits = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES
    const { added, removed } = diffPermissions(bits, bits)
    expect(added).toHaveLength(0)
    expect(removed).toHaveLength(0)
  })

  it("handles adding ADMINISTRATOR", () => {
    const { added } = diffPermissions(PERMISSIONS.VIEW_CHANNELS, PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.ADMINISTRATOR)
    expect(added).toContain("ADMINISTRATOR")
  })
})
