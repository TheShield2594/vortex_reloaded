import { beforeEach, describe, expect, it, vi } from "vitest"
import { PRESENCE_KEY_PREFIX } from "@vortex/shared"

const hgetMany = vi.fn<(keys: string[], field: string) => Promise<(string | null)[]>>()
const getRedisClient = vi.fn<() => Promise<{ hgetMany: typeof hgetMany } | null>>()

vi.mock("@/lib/redis-client", () => ({
  getRedisClient: () => getRedisClient(),
}))

const { createPresenceResolver } = await import("./presence")

/** Answer a hgetMany call from a userId -> live status map. */
function live(entries: Record<string, string>): void {
  getRedisClient.mockResolvedValue({ hgetMany })
  hgetMany.mockImplementation(async (keys) =>
    keys.map((key) => entries[key.slice(PRESENCE_KEY_PREFIX.length + 1)] ?? null)
  )
}

beforeEach(() => {
  getRedisClient.mockReset()
  hgetMany.mockReset()
})

describe("createPresenceResolver", () => {
  it("serves the gateway's status, not the stored one", async () => {
    live({ "user-1": "idle" })

    const presence = await createPresenceResolver(["user-1"])
    expect(presence("user-1", "online")).toBe("idle")
  })

  it("reports a user with no gateway connection as offline, whatever the DB says", async () => {
    // The exact split-brain from issue #57: users.status says online because
    // that's what the user last picked, but nobody is connected.
    live({})

    const presence = await createPresenceResolver(["user-1"])
    expect(presence("user-1", "online")).toBe("offline")
  })

  it("masks invisible users as offline", async () => {
    live({ "user-1": "invisible" })

    const presence = await createPresenceResolver(["user-1"])
    expect(presence("user-1", "invisible")).toBe("offline")
  })

  it("reads every user in one round trip and keys results positionally", async () => {
    live({ "user-1": "online", "user-3": "dnd" })

    const presence = await createPresenceResolver(["user-1", "user-2", "user-3"])

    expect(hgetMany).toHaveBeenCalledTimes(1)
    expect(hgetMany).toHaveBeenCalledWith(
      [`${PRESENCE_KEY_PREFIX}:user-1`, `${PRESENCE_KEY_PREFIX}:user-2`, `${PRESENCE_KEY_PREFIX}:user-3`],
      "status"
    )
    expect(presence("user-1", "offline")).toBe("online")
    expect(presence("user-2", "online")).toBe("offline")
    expect(presence("user-3", "online")).toBe("dnd")
  })

  it("deduplicates ids before hitting Redis", async () => {
    live({ "user-1": "online" })

    await createPresenceResolver(["user-1", "user-1", "user-1"])
    expect(hgetMany).toHaveBeenCalledWith([`${PRESENCE_KEY_PREFIX}:user-1`], "status")
  })

  it("treats an entry with an unreadable status as connected", async () => {
    live({ "user-1": "wat" })

    const presence = await createPresenceResolver(["user-1"])
    expect(presence("user-1", "offline")).toBe("online")
  })

  it("falls back to the stored status when Redis isn't configured", async () => {
    getRedisClient.mockResolvedValue(null)

    const presence = await createPresenceResolver(["user-1"])
    expect(presence("user-1", "dnd")).toBe("dnd")
    expect(presence("user-1", "invisible")).toBe("offline")
    expect(presence("user-1", null)).toBe("offline")
    expect(presence("user-1", "bogus")).toBe("offline")
  })

  it("falls back to the stored status when the lookup fails", async () => {
    getRedisClient.mockResolvedValue({ hgetMany })
    hgetMany.mockRejectedValue(new Error("connection reset"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const presence = await createPresenceResolver(["user-1"])
    expect(presence("user-1", "online")).toBe("online")
    consoleError.mockRestore()
  })

  it("skips the Redis round trip when there is nobody to resolve", async () => {
    getRedisClient.mockResolvedValue({ hgetMany })

    const presence = await createPresenceResolver([])
    expect(hgetMany).not.toHaveBeenCalled()
    // Anyone asked about outside the batch is, by definition, not connected.
    expect(presence("user-1", "online")).toBe("offline")
  })
})
