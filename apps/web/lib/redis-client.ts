/**
 * Unified Redis client for VortexChat.
 *
 * Supports two backends:
 *
 * 1. **Standard Redis** (self-hosted) — set `REDIS_URL` to a `redis://` or
 *    `rediss://` connection string. Uses the `ioredis` driver (same protocol
 *    as the signal server).
 *
 * 2. **Upstash Redis** (serverless / Vercel) — set `UPSTASH_REDIS_REST_URL`
 *    and `UPSTASH_REDIS_REST_TOKEN`. Uses the `@upstash/redis` HTTP driver.
 *
 * If both are set, `REDIS_URL` takes priority (cheaper for self-hosters).
 * If neither is set, returns `null` — callers fall back to in-memory stores.
 *
 * The interface is intentionally minimal: only the operations actually used
 * by `server-cache.ts`, `rate-limit.ts` and `presence.ts`.
 */

export interface RedisClient {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>
  del(...keys: string[]): Promise<void>
  scan(cursor: number, opts: { match: string; count: number }): Promise<[number, string[]]>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>
  /**
   * Read one field from each of several hashes in a single round trip.
   * Returns a value per key, positionally, with `null` for a missing hash or
   * a missing field. Used to read the gateway's presence hashes in bulk.
   *
   * Rejects if any command in the batch failed: `null` means the key or field
   * genuinely isn't there, so a failed read must never be reported as one.
   */
  hgetMany(keys: string[], field: string): Promise<(string | null)[]>
  /** Clean up connections on shutdown. */
  quit(): Promise<void>
}

// ─── Detection ──────────────────────────────────────────────────────────────

const hasStandardRedis =
  typeof process !== "undefined" && !!process.env.REDIS_URL

const hasUpstash =
  typeof process !== "undefined" &&
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN

export const redisConfigured = hasStandardRedis || hasUpstash

// ─── Lazy singleton ─────────────────────────────────────────────────────────

let instance: RedisClient | null = null
let initPromise: Promise<RedisClient | null> | null = null

export async function getRedisClient(): Promise<RedisClient | null> {
  if (!redisConfigured) return null
  if (instance) return instance
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      if (hasStandardRedis) {
        instance = await createIoRedisClient()
      } else if (hasUpstash) {
        instance = await createUpstashClient()
      }
      return instance
    } catch (err) {
      console.error("[redis-client] Failed to initialize:", err instanceof Error ? err.message : String(err))
      return null
    } finally {
      initPromise = null
    }
  })()

  return initPromise
}

// ─── ioredis adapter (standard Redis) ───────────────────────────────────────

async function createIoRedisClient(): Promise<RedisClient> {
  const { default: Redis } = await import("ioredis")
  const client = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableReadyCheck: true,
  })
  await client.connect()

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = await client.get(key)
      if (raw === null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return raw as unknown as T
      }
    },

    async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
      const serialized = typeof value === "string" ? value : JSON.stringify(value)
      if (opts?.ex) {
        await client.set(key, serialized, "EX", opts.ex)
      } else {
        await client.set(key, serialized)
      }
    },

    async del(...keys: string[]): Promise<void> {
      if (keys.length > 0) await client.del(...keys)
    },

    async scan(cursor: number, opts: { match: string; count: number }): Promise<[number, string[]]> {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", opts.match, "COUNT", opts.count)
      return [Number(nextCursor), keys]
    },

    async incr(key: string): Promise<number> {
      return client.incr(key)
    },

    async expire(key: string, seconds: number): Promise<void> {
      await client.expire(key, seconds)
    },

    async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
      return client.eval(script, keys.length, ...keys, ...args)
    },

    async hgetMany(keys: string[], field: string): Promise<(string | null)[]> {
      if (keys.length === 0) return []
      const pipeline = client.pipeline()
      for (const key of keys) pipeline.hget(key, field)
      const results = await pipeline.exec()
      // ioredis reports a per-command failure in the tuple's first slot and a
      // discarded pipeline as a null result. Both mean "we don't know what is
      // in Redis", which is not the same answer as "the key isn't there" —
      // swallowing them as null would make a Redis fault look like a
      // definitive empty read to callers. Reject so they can fall back.
      if (!results || results.length !== keys.length) {
        throw new Error(`hgetMany: expected ${keys.length} pipeline results, got ${results?.length ?? "none"}`)
      }
      return results.map(([err, value]) => {
        if (err) throw err
        return typeof value === "string" ? value : null
      })
    },

    async quit(): Promise<void> {
      await client.quit()
    },
  }
}

// ─── Upstash adapter (HTTP / serverless) ────────────────────────────────────

async function createUpstashClient(): Promise<RedisClient> {
  const { Redis } = await import("@upstash/redis")
  const client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const value = await client.get<T>(key)
      return value ?? null
    },

    async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
      if (opts?.ex) {
        await client.set(key, value, { ex: opts.ex })
      } else {
        await client.set(key, value)
      }
    },

    async del(...keys: string[]): Promise<void> {
      if (keys.length > 0) await client.del(...keys)
    },

    async scan(cursor: number, opts: { match: string; count: number }): Promise<[number, string[]]> {
      const result = await client.scan(cursor, { match: opts.match, count: opts.count })
      return [Number(result[0]), result[1] as string[]]
    },

    async incr(key: string): Promise<number> {
      return client.incr(key)
    },

    async expire(key: string, seconds: number): Promise<void> {
      await client.expire(key, seconds)
    },

    async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
      return client.eval(script, keys, args)
    },

    async hgetMany(keys: string[], field: string): Promise<(string | null)[]> {
      if (keys.length === 0) return []
      const pipeline = client.pipeline()
      for (const key of keys) pipeline.hget(key, field)
      // Upstash's exec() already rejects if any command in the batch failed,
      // so reaching here means every result is a real read (see hgetMany's
      // contract on RedisClient).
      const results = await pipeline.exec<(string | null)[]>()
      if (!results || results.length !== keys.length) {
        throw new Error(`hgetMany: expected ${keys.length} pipeline results, got ${results?.length ?? "none"}`)
      }
      return results.map((value) => (typeof value === "string" ? value : null))
    },

    async quit(): Promise<void> {
      // Upstash HTTP client is stateless — nothing to close.
    },
  }
}
