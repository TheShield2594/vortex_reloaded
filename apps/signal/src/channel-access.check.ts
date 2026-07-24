import { writeFileSync, mkdirSync } from "node:fs"
import { createChannelAccessChecker } from "./channel-access"

/**
 * Assertions for the gateway channel-membership authorizer (issue #51).
 * Run with `tsx src/channel-access.check.ts` (mirrors rooms.parity-check.ts).
 */

type FetchStub = (url: string, init: { body?: unknown }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

/** Swap global fetch for the duration of `fn`. */
async function withFetch<T>(stub: FetchStub, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  // @ts-expect-error test stub signature is intentionally narrower
  globalThis.fetch = stub
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

async function run(): Promise<void> {
  const results: Array<{ name: string; pass: boolean; error?: string }> = []
  const config = { webAppUrl: "http://web:3000", secret: "test-secret" }

  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
      results.push({ name, pass: true })
    } catch (error) {
      results.push({ name, pass: false, error: (error as Error).message })
    }
  }

  // user:{id} channels are resolved locally: owner allowed, others denied,
  // without any network call.
  await check("user channel owner-only", async () => {
    let called = false
    const stub: FetchStub = async () => {
      called = true
      return { ok: true, status: 200, json: async () => ({ allowed: [] }) }
    }
    const checker = createChannelAccessChecker(config)
    const allowed = await withFetch(stub, () =>
      checker("user-a", ["user:user-a", "user:user-b"])
    )
    if (!sortedEqual(allowed, ["user:user-a"])) throw new Error(`got ${JSON.stringify(allowed)}`)
    if (called) throw new Error("user:{id} channels must not hit the network")
  })

  // DM channels: only the subset the web app grants is returned.
  await check("dm membership honored", async () => {
    const stub: FetchStub = async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { userId: string; channelIds: string[] }
      if (body.userId !== "user-a") throw new Error("wrong userId forwarded")
      // Only "dm-1" is a real membership; "dm-2" is not.
      const allowed = body.channelIds.filter((id) => id === "dm-1")
      return { ok: true, status: 200, json: async () => ({ allowed }) }
    }
    const checker = createChannelAccessChecker(config)
    const allowed = await withFetch(stub, () =>
      checker("user-a", ["user:user-a", "dm-1", "dm-2"])
    )
    if (!sortedEqual(allowed, ["user:user-a", "dm-1"])) throw new Error(`got ${JSON.stringify(allowed)}`)
  })

  // Fail closed on a non-2xx response: DM channels denied, but the locally
  // resolved user:{owner} channel still allowed.
  await check("fail closed on http error", async () => {
    const stub: FetchStub = async () => ({ ok: false, status: 500, json: async () => ({}) })
    const checker = createChannelAccessChecker(config)
    const allowed = await withFetch(stub, () =>
      checker("user-a", ["user:user-a", "dm-1"])
    )
    if (!sortedEqual(allowed, ["user:user-a"])) throw new Error(`got ${JSON.stringify(allowed)}`)
  })

  // Fail closed when fetch throws (endpoint unreachable / timeout abort).
  await check("fail closed on fetch throw", async () => {
    const stub: FetchStub = async () => {
      throw new Error("network down")
    }
    const checker = createChannelAccessChecker(config)
    const allowed = await withFetch(stub, () => checker("user-a", ["dm-1"]))
    if (!sortedEqual(allowed, [])) throw new Error(`got ${JSON.stringify(allowed)}`)
  })

  // Unconfigured (dev): DM channels allowed with no network, but user:{other}
  // is still rejected by the local ownership rule.
  await check("unconfigured dev parity", async () => {
    const checker = createChannelAccessChecker(null)
    const allowed = await checker("user-a", ["user:user-a", "user:user-b", "dm-1"])
    if (!sortedEqual(allowed, ["user:user-a", "dm-1"])) throw new Error(`got ${JSON.stringify(allowed)}`)
  })

  mkdirSync(".reports", { recursive: true })
  writeFileSync(
    ".reports/channel-access.json",
    JSON.stringify({ success: results.every((r) => r.pass), results }, null, 2)
  )
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.error ? ` — ${r.error}` : ""}`)
  }
  if (results.some((r) => !r.pass)) process.exit(1)
}

run()
