import { writeFileSync, mkdirSync } from "node:fs"
import { SessionRevocationStore, REVOCATION_TTL_SECONDS, type RevocationRedis } from "./revocation"

/**
 * Assertions for the per-user session revocation store (issue #52).
 * Run with `tsx src/revocation.check.ts` (mirrors channel-access.check.ts).
 */

/** Minimal in-process stand-in for the ioredis surface the store uses. */
function fakeRedis(): RevocationRedis & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: string) {
      store.set(key, value)
      return "OK"
    },
  }
}

const SECONDS = 1000

async function run(): Promise<void> {
  const results: Array<{ name: string; pass: boolean; error?: string }> = []

  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
      results.push({ name, pass: true })
    } catch (error) {
      results.push({ name, pass: false, error: (error as Error).message })
    }
  }

  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(msg)
  }

  // A user with no revocation on record is never treated as revoked.
  await check("no revocation → not revoked (in-memory)", async () => {
    const store = new SessionRevocationStore(null, () => 1_000_000)
    assert((await store.isRevoked("user-a", 999)) === false, "unexpected revocation")
  })

  // After revoking at T, a token issued strictly before T is rejected and one
  // issued at/after T (the fresh token a reconnecting device fetches) passes.
  await check("iat cutoff splits pre/post tokens (in-memory)", async () => {
    let now = 100 * SECONDS
    const store = new SessionRevocationStore(null, () => now)
    await store.revoke("user-a") // cutoff = 100_000 ms

    const preIat = 90 // 90s = 90_000ms < 100_000ms cutoff
    const postIat = 110 // 110s = 110_000ms >= cutoff
    assert((await store.isRevoked("user-a", preIat)) === true, "pre-cutoff token should be revoked")
    assert((await store.isRevoked("user-a", postIat)) === false, "post-cutoff token should be admitted")
    now += 5 * SECONDS
  })

  // Revocation is scoped to the user it targets; a different user is untouched.
  await check("revocation is per-user (in-memory)", async () => {
    const store = new SessionRevocationStore(null, () => 100 * SECONDS)
    await store.revoke("user-a")
    assert((await store.isRevoked("user-a", 50)) === true, "target user not revoked")
    assert((await store.isRevoked("user-b", 50)) === false, "bystander user revoked")
  })

  // Once the TTL window elapses, the cutoff is forgotten (every pre-cutoff
  // token has expired on its own by then) and pruneExpired drops the entry.
  await check("cutoff expires after TTL (in-memory)", async () => {
    let now = 100 * SECONDS
    const store = new SessionRevocationStore(null, () => now)
    await store.revoke("user-a")
    assert((await store.isRevoked("user-a", 50)) === true, "should be revoked within TTL")
    now += (REVOCATION_TTL_SECONDS + 1) * SECONDS
    assert((await store.isRevoked("user-a", 50)) === false, "should lapse after TTL")
    store.pruneExpired()
    assert((await store.isRevoked("user-a", 50)) === false, "prune should leave it lapsed")
  })

  // Redis-backed path: cutoff persisted under the namespaced key, same
  // pre/post-cutoff decision, driven off the stored millisecond value.
  await check("redis-backed cutoff splits pre/post tokens", async () => {
    const redis = fakeRedis()
    const store = new SessionRevocationStore(redis, () => 100 * SECONDS)
    await store.revoke("user-a")
    assert(redis.store.get("vortex:revoked-user:user-a") === String(100 * SECONDS), "cutoff not persisted under namespaced key")
    assert((await store.isRevoked("user-a", 90)) === true, "pre-cutoff token should be revoked")
    assert((await store.isRevoked("user-a", 110)) === false, "post-cutoff token should be admitted")
    assert((await store.isRevoked("user-b", 90)) === false, "unrevoked user should pass")
  })

  mkdirSync(".reports", { recursive: true })
  writeFileSync(
    ".reports/revocation.json",
    JSON.stringify({ success: results.every((r) => r.pass), results }, null, 2),
  )
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.error ? ` — ${r.error}` : ""}`)
  }
  if (results.some((r) => !r.pass)) process.exit(1)
}

run()
