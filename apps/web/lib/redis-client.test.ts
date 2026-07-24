import { beforeAll, describe, expect, it, vi } from "vitest"

/**
 * hgetMany's contract is load-bearing for presence: `null` means the key or
 * field genuinely isn't in Redis (the user is offline), so a failed read must
 * reject instead of masquerading as an empty one — see lib/presence.ts.
 */

const hget = vi.fn()
const exec = vi.fn()

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    connect = async () => {}
    pipeline = () => ({ hget, exec })
  },
}))

let getRedisClient: typeof import("./redis-client").getRedisClient

beforeAll(async () => {
  process.env.REDIS_URL = "redis://localhost:6379"
  ;({ getRedisClient } = await import("./redis-client"))
})

async function client() {
  const redis = await getRedisClient()
  if (!redis) throw new Error("expected a Redis client")
  return redis
}

describe("hgetMany (ioredis adapter)", () => {
  it("returns values positionally, with null for a missing key or field", async () => {
    exec.mockResolvedValue([
      [null, "online"],
      [null, null],
    ])

    await expect((await client()).hgetMany(["a", "b"], "status")).resolves.toEqual(["online", null])
  })

  it("rejects when any command in the batch failed", async () => {
    exec.mockResolvedValue([
      [null, "online"],
      [new Error("WRONGTYPE"), null],
    ])

    await expect((await client()).hgetMany(["a", "b"], "status")).rejects.toThrow("WRONGTYPE")
  })

  it("rejects when the pipeline was discarded", async () => {
    exec.mockResolvedValue(null)

    await expect((await client()).hgetMany(["a", "b"], "status")).rejects.toThrow(/expected 2 pipeline results/)
  })

  it("skips Redis entirely for an empty batch", async () => {
    exec.mockClear()

    await expect((await client()).hgetMany([], "status")).resolves.toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })
})
