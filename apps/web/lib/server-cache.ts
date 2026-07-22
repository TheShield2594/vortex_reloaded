/**
 * Application cache with Redis primary + in-memory fallback.
 *
 * Supports two Redis backends via `lib/redis-client.ts`:
 *   - Standard Redis (self-hosted) — set `REDIS_URL`
 *   - Upstash Redis (serverless) — set `UPSTASH_REDIS_REST_URL` + token
 *
 * Falls back to an in-memory TTL cache when Redis is unavailable or not
 * configured (local dev / single-instance deployments).
 *
 * Use for: automod rules, server settings, permissions, channel metadata,
 *          role lists, user profiles, member counts.
 * Do NOT use for: rate limits (use rate-limit.ts), user-specific real-time
 *                  state, nonce checks.
 */

import { getRedisClient, redisConfigured, type RedisClient } from "@/lib/redis-client"

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// ─── In-memory store (L1 / fallback) ────────────────────────────────────────

const memStore = new Map<string, CacheEntry<unknown>>()

// ─── Redis access ───────────────────────────────────────────────────────────

async function getRedis(): Promise<RedisClient | null> {
  if (!redisConfigured) return null
  try {
    return await getRedisClient()
  } catch {
    return null
  }
}

const CACHE_PREFIX = "vortex:cache:"

// ─── Default TTLs by domain ─────────────────────────────────────────────────

export const CACHE_TTLS = {
  SERVER_SETTINGS: 60_000,
  CHANNEL_METADATA: 60_000,
  MEMBER_PERMISSIONS: 30_000,
  ROLE_LIST: 60_000,
  AUTOMOD_RULES: 60_000,
  USER_PROFILE: 120_000,
  MEMBER_COUNT: 300_000,
} as const

const DEFAULT_TTL_MS = 60_000 // 60 seconds

// ─── Main API ───────────────────────────────────────────────────────────────

/** Get a cached value, or compute and cache it if missing/expired. */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now()

  // L1: Check in-memory first (fastest path)
  const memEntry = memStore.get(key) as CacheEntry<T> | undefined
  if (memEntry && memEntry.expiresAt > now) {
    return memEntry.value
  }

  // L2: Check Redis if configured
  const redis = await getRedis()
  if (redis) {
    try {
      const redisValue = await redis.get<T>(`${CACHE_PREFIX}${key}`)
      if (redisValue !== null && redisValue !== undefined) {
        // Populate L1 with the Redis value
        memStore.set(key, { value: redisValue, expiresAt: now + ttlMs })
        return redisValue
      }
    } catch {
      // Redis unavailable — fall through to fetcher
    }
  }

  // Cache miss — compute the value
  const value = await fetcher()

  // Store in L1
  memStore.set(key, { value, expiresAt: now + ttlMs })

  // Store in L2 (Redis) — fire and forget
  if (redis) {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000))
    redis.set(`${CACHE_PREFIX}${key}`, value, { ex: ttlSeconds }).catch(() => {
      // Silently ignore Redis write failures — L1 still has the value
    })
  }

  return value
}

/** Invalidate a specific cache key (both L1 and L2). */
export function invalidate(key: string): void {
  memStore.delete(key)
  getRedis().then((redis) => {
    if (redis) redis.del(`${CACHE_PREFIX}${key}`).catch(() => {})
  }).catch(() => {})
}

/** Invalidate all keys matching a prefix (L1 immediately, L2 via scan). */
export function invalidatePrefix(prefix: string): void {
  // L1: immediate
  for (const key of memStore.keys()) {
    if (key.startsWith(prefix)) memStore.delete(key)
  }

  // L2: Redis scan + delete (best-effort, non-blocking)
  getRedis().then(async (redis) => {
    if (!redis) return
    try {
      let cursor = 0
      do {
        const result = await redis.scan(cursor, {
          match: `${CACHE_PREFIX}${prefix}*`,
          count: 100,
        })
        cursor = Number(result[0])
        const keys = result[1] as string[]
        if (keys.length > 0) {
          await redis.del(...keys)
        }
      } while (cursor !== 0)
    } catch {
      // Best-effort cleanup — entries will expire via TTL
    }
  }).catch(() => {})
}

// ─── Cache header helpers ───────────────────────────────────────────────────

/** Returns cache-status headers for API responses (debugging/monitoring). */
export function cacheHeaders(hit: boolean): Record<string, string> {
  return {
    "X-Cache": hit ? "HIT" : "MISS",
    "Cache-Control": "private, max-age=5, stale-while-revalidate=15",
  }
}

// ─── Periodic cleanup of expired in-memory entries (every 5 minutes) ────────

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memStore) {
      if (entry.expiresAt <= now) memStore.delete(key)
    }
  }, 5 * 60_000).unref?.()
}
