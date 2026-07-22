import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("search route permission contracts", () => {
  it("enforces per-channel VIEW_CHANNELS permission checks", () => {
    const routePath = resolve(process.cwd(), "app/api/search/route.ts")
    const source = readFileSync(routePath, "utf8")

    expect(source).toContain("getBatchChannelPermissions")
    expect(source).toContain('hasPermission(perms.permissions, "VIEW_CHANNELS")')
  })
})
