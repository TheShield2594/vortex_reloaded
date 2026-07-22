import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PERMISSIONS } from "@vortex/shared"

describe("permission contracts", () => {
  it("uses MODERATE_MEMBERS from shared package for timeout checks", () => {
    const timeoutRoutePath = resolve(process.cwd(), "app/api/servers/[serverId]/members/[userId]/timeout/route.ts")
    const source = readFileSync(timeoutRoutePath, "utf8")

    expect(source).toContain("PERMISSIONS.MODERATE_MEMBERS")
    expect(source).not.toContain("1 << 10")
    expect(PERMISSIONS.MODERATE_MEMBERS).toBe(1 << 14)
  })
})
