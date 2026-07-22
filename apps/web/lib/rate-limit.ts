/**
 * Rate limiter with Redis backend for multi-instance deployments.
 *
 * Supports two Redis backends via `lib/redis-client.ts`:
 *   - Standard Redis (self-hosted) — set `REDIS_URL`
 *   - Upstash Redis (serverless) — set `UPSTASH_REDIS_REST_URL` + token
 *
 * Uses a Lua-based sliding window algorithm that works on any Redis server.
 *
 * Falls back to an in-memory sliding window when Redis is not configured
 * (local dev or single-instance deployments).
 *
 * Usage:
 *   const result = await rateLimiter.check(userId, { limit: 5, windowMs: 10_000 })
 *   if (!result.allowed) return 429
 */

import { getRedisClient, redisConfigured } from "@/lib/redis-client"

type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: number
}

// ─── Redis sliding-window rate limiter ──────────────────────────────────────

/**
 * Lua script for sliding-window rate limiting.
 * Works on any Redis >= 3.2 (standard or Upstash).
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = window size in ms
 * ARGV[2] = max requests per window
 * ARGV[3] = current timestamp in ms
 *
 * Returns: [allowed (0/1), remaining, resetAt (ms)]
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, now + window}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + window
  if oldest and #oldest >= 2 then
    resetAt = tonumber(oldest[2]) + window
  end
  return {0, 0, resetAt}
end
`

async function checkRedis(
  key: string,
  opts: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const redis = await getRedisClient()
  if (!redis) {
    throw new Error("Redis not available")
  }

  const now = Date.now()
  const redisKey = `vortex:rl:${key}`

  try {
    const result = await redis.eval(
      SLIDING_WINDOW_LUA,
      [redisKey],
      [opts.windowMs, opts.limit, now]
    ) as [number, number, number]

    return {
      allowed: result[0] === 1,
      remaining: Number(result[1]),
      resetAt: Number(result[2]),
    }
  } catch (err) {
    throw new Error(`Redis rate-limit check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── In-memory fallback ──────────────────────────────────────────────────────

interface WindowEntry {
  timestamps: number[]
}

class InMemoryRateLimiter {
  private windows = new Map<string, WindowEntry>()

  check(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
    const now = Date.now()
    const cutoff = now - opts.windowMs

    let entry = this.windows.get(key)
    if (!entry) {
      entry = { timestamps: [] }
      this.windows.set(key, entry)
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

    const remaining = Math.max(0, opts.limit - entry.timestamps.length)
    const resetAt = entry.timestamps[0] ? entry.timestamps[0] + opts.windowMs : now + opts.windowMs

    if (entry.timestamps.length >= opts.limit) {
      return { allowed: false, remaining: 0, resetAt }
    }

    entry.timestamps.push(now)
    return { allowed: true, remaining: remaining - 1, resetAt }
  }

  cleanup(maxAgeMs = 60_000) {
    const cutoff = Date.now() - maxAgeMs
    this.windows.forEach((entry, key) => {
      if (entry.timestamps.every((t: number) => t < cutoff)) {
        this.windows.delete(key)
      }
    })
  }
}

const inMemory = new InMemoryRateLimiter()

if (typeof setInterval !== "undefined") {
  setInterval(() => inMemory.cleanup(), 5 * 60 * 1000)
}

// ─── Unified interface ───────────────────────────────────────────────────────

const useRedis = redisConfigured

interface CheckOptions {
  limit: number
  windowMs: number
  /** When true, treat rate-limiter infrastructure failures as "blocked" instead of
   *  allowing the request through.  Use for auth endpoints where fail-open would
   *  let attackers bypass brute-force protection when Redis is down. */
  failClosed?: boolean
}

export const rateLimiter = {
  async check(key: string, opts: CheckOptions): Promise<RateLimitResult> {
    try {
      if (useRedis) {
        return await checkRedis(key, opts)
      }
      return inMemory.check(key, opts)
    } catch (err) {
      if (opts.failClosed) {
        // Structured log import avoided here to prevent circular deps;
        // Sentry will also capture this via global error handling.
        const action = key.split(":")[0] ?? "unknown"
        console.error("[rate-limit] Infrastructure failure (fail-closed)", {
          action,
          limit: opts.limit,
          windowMs: opts.windowMs,
          error: err instanceof Error ? err.message : String(err),
        })
        return { allowed: false, remaining: 0, resetAt: Date.now() + 60_000 }
      }
      throw err
    }
  },
}
