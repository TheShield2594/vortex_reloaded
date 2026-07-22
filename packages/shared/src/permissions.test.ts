import { describe, it, expect } from "vitest"
import {
  PERMISSIONS,
  computePermissions,
  hasPermission,
  addPermission,
  removePermission,
  type Permission,
} from "./index"

// ---------------------------------------------------------------------------
// PERMISSIONS constant sanity checks
// ---------------------------------------------------------------------------

describe("PERMISSIONS bitmask constants", () => {
  it("each permission is a unique power of two", () => {
    const values = Object.values(PERMISSIONS)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
    for (const v of values) {
      expect(v & (v - 1)).toBe(0) // power of two: only one bit set
    }
  })

  it("covers all required Discord-parity permissions", () => {
    const required: Permission[] = [
      "MANAGE_WEBHOOKS",
      "MANAGE_EVENTS",
      "MODERATE_MEMBERS",
      "CREATE_PUBLIC_THREADS",
      "CREATE_PRIVATE_THREADS",
      "SEND_MESSAGES_IN_THREADS",
      "USE_APPLICATION_COMMANDS",
      "MENTION_EVERYONE",
    ]
    for (const p of required) {
      expect(PERMISSIONS[p], `${p} should be defined`).toBeDefined()
    }
  })

  it("ADMINISTRATOR is 128 (1 << 7)", () => {
    expect(PERMISSIONS.ADMINISTRATOR).toBe(128)
  })

  it("MANAGE_MESSAGES is 4 (1 << 2), not 2048", () => {
    expect(PERMISSIONS.MANAGE_MESSAGES).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// computePermissions
// ---------------------------------------------------------------------------

describe("computePermissions", () => {
  it("returns 0 for empty array", () => {
    expect(computePermissions([])).toBe(0)
  })

  it("ORs multiple role bitmasks together", () => {
    const result = computePermissions([
      PERMISSIONS.VIEW_CHANNELS,
      PERMISSIONS.SEND_MESSAGES,
      PERMISSIONS.KICK_MEMBERS,
    ])
    expect(result).toBe(
      PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.KICK_MEMBERS
    )
  })

  it("is idempotent when the same bit appears in multiple roles", () => {
    const result = computePermissions([
      PERMISSIONS.SEND_MESSAGES,
      PERMISSIONS.SEND_MESSAGES,
    ])
    expect(result).toBe(PERMISSIONS.SEND_MESSAGES)
  })

  it("handles all-permissions scenario (ADMINISTRATOR bit)", () => {
    const allPerms = Object.values(PERMISSIONS).reduce((acc, v) => acc | v, 0)
    const result = computePermissions(Object.values(PERMISSIONS))
    expect(result).toBe(allPerms)
    expect(result & PERMISSIONS.ADMINISTRATOR).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// hasPermission
// ---------------------------------------------------------------------------

describe("hasPermission", () => {
  it("returns true when the specific bit is set", () => {
    const perms = PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS
    expect(hasPermission(perms, "SEND_MESSAGES")).toBe(true)
    expect(hasPermission(perms, "VIEW_CHANNELS")).toBe(true)
  })

  it("returns false when the bit is not set", () => {
    const perms = PERMISSIONS.VIEW_CHANNELS
    expect(hasPermission(perms, "SEND_MESSAGES")).toBe(false)
    expect(hasPermission(perms, "BAN_MEMBERS")).toBe(false)
  })

  it("ADMINISTRATOR bit bypasses every specific permission check", () => {
    const adminPerms = PERMISSIONS.ADMINISTRATOR
    const allKeys = Object.keys(PERMISSIONS) as Permission[]
    for (const key of allKeys) {
      expect(hasPermission(adminPerms, key)).toBe(true)
    }
  })

  it("returns false for 0 permissions bitmask", () => {
    expect(hasPermission(0, "VIEW_CHANNELS")).toBe(false)
    expect(hasPermission(0, "ADMINISTRATOR")).toBe(false)
  })

  it("correctly resolves new extended permissions", () => {
    const perms =
      PERMISSIONS.MENTION_EVERYONE |
      PERMISSIONS.MANAGE_WEBHOOKS |
      PERMISSIONS.MODERATE_MEMBERS |
      PERMISSIONS.USE_APPLICATION_COMMANDS

    expect(hasPermission(perms, "MENTION_EVERYONE")).toBe(true)
    expect(hasPermission(perms, "MANAGE_WEBHOOKS")).toBe(true)
    expect(hasPermission(perms, "MODERATE_MEMBERS")).toBe(true)
    expect(hasPermission(perms, "USE_APPLICATION_COMMANDS")).toBe(true)

    // Should NOT have unset permissions
    expect(hasPermission(perms, "BAN_MEMBERS")).toBe(false)
    expect(hasPermission(perms, "MANAGE_EVENTS")).toBe(false)
    expect(hasPermission(perms, "CREATE_PRIVATE_THREADS")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// addPermission / removePermission
// ---------------------------------------------------------------------------

describe("addPermission", () => {
  it("sets the specified bit", () => {
    const perms = addPermission(0, "SEND_MESSAGES")
    expect(perms & PERMISSIONS.SEND_MESSAGES).toBeTruthy()
  })

  it("is a no-op if the bit is already set", () => {
    const perms = PERMISSIONS.SEND_MESSAGES
    expect(addPermission(perms, "SEND_MESSAGES")).toBe(perms)
  })

  it("does not touch other bits", () => {
    const perms = PERMISSIONS.VIEW_CHANNELS
    const result = addPermission(perms, "BAN_MEMBERS")
    expect(result & PERMISSIONS.VIEW_CHANNELS).toBeTruthy()
    expect(result & PERMISSIONS.BAN_MEMBERS).toBeTruthy()
  })
})

describe("removePermission", () => {
  it("clears the specified bit", () => {
    const perms = PERMISSIONS.SEND_MESSAGES | PERMISSIONS.VIEW_CHANNELS
    const result = removePermission(perms, "SEND_MESSAGES")
    expect(result & PERMISSIONS.SEND_MESSAGES).toBe(0)
    expect(result & PERMISSIONS.VIEW_CHANNELS).toBeTruthy()
  })

  it("is a no-op if the bit was not set", () => {
    const perms = PERMISSIONS.VIEW_CHANNELS
    expect(removePermission(perms, "BAN_MEMBERS")).toBe(perms)
  })
})

// ---------------------------------------------------------------------------
// Edge cases: combined roles (mimics what getMemberPermissions does server-side)
// ---------------------------------------------------------------------------

describe("combined role resolution edge cases", () => {
  it("member with no roles has no permissions", () => {
    const effective = computePermissions([])
    expect(hasPermission(effective, "SEND_MESSAGES")).toBe(false)
  })

  it("default @everyone role (VIEW_CHANNELS | SEND_MESSAGES) grants basic access", () => {
    // Default role bitmask is 3 = VIEW_CHANNELS (1) | SEND_MESSAGES (2)
    const everyonePerms = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES // 3
    expect(hasPermission(everyonePerms, "VIEW_CHANNELS")).toBe(true)
    expect(hasPermission(everyonePerms, "SEND_MESSAGES")).toBe(true)
    expect(hasPermission(everyonePerms, "KICK_MEMBERS")).toBe(false)
  })

  it("member with moderator + member roles inherits combined permissions", () => {
    const memberRole = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES
    const moderatorRole = PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MANAGE_MESSAGES | PERMISSIONS.MODERATE_MEMBERS
    const effective = computePermissions([memberRole, moderatorRole])

    expect(hasPermission(effective, "VIEW_CHANNELS")).toBe(true)
    expect(hasPermission(effective, "SEND_MESSAGES")).toBe(true)
    expect(hasPermission(effective, "KICK_MEMBERS")).toBe(true)
    expect(hasPermission(effective, "MANAGE_MESSAGES")).toBe(true)
    expect(hasPermission(effective, "MODERATE_MEMBERS")).toBe(true)
    // Should still NOT have admin
    expect(hasPermission(effective, "ADMINISTRATOR")).toBe(false)
  })

  it("a single ADMINISTRATOR role grants every permission", () => {
    const effective = computePermissions([PERMISSIONS.ADMINISTRATOR])
    expect(hasPermission(effective, "MENTION_EVERYONE")).toBe(true)
    expect(hasPermission(effective, "MANAGE_WEBHOOKS")).toBe(true)
    expect(hasPermission(effective, "MODERATE_MEMBERS")).toBe(true)
    expect(hasPermission(effective, "CREATE_PRIVATE_THREADS")).toBe(true)
  })

  it("MENTION_EVERYONE is not included in default roles (requires explicit grant)", () => {
    // Simulate the migrated default value: 3 | USE_APPLICATION_COMMANDS (262144)
    const defaultRoleAfterMigration =
      PERMISSIONS.VIEW_CHANNELS |
      PERMISSIONS.SEND_MESSAGES |
      PERMISSIONS.USE_APPLICATION_COMMANDS

    expect(hasPermission(defaultRoleAfterMigration, "USE_APPLICATION_COMMANDS")).toBe(true)
    expect(hasPermission(defaultRoleAfterMigration, "MENTION_EVERYONE")).toBe(false)
  })

  it("removing ADMINISTRATOR and re-checking enforces specific bits", () => {
    let perms = PERMISSIONS.ADMINISTRATOR | PERMISSIONS.SEND_MESSAGES
    perms = removePermission(perms, "ADMINISTRATOR")
    // Without admin, only SEND_MESSAGES should pass
    expect(hasPermission(perms, "SEND_MESSAGES")).toBe(true)
    expect(hasPermission(perms, "BAN_MEMBERS")).toBe(false)
    expect(hasPermission(perms, "MENTION_EVERYONE")).toBe(false)
  })
})
