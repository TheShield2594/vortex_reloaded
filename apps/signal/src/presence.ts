/**
 * WebSocket-Based Presence Manager
 *
 * Replaces HTTP polling heartbeats with Socket.IO connection-based presence.
 * Detects offline in ~10s (Socket.IO pingTimeout) instead of ~90s (30s heartbeat + 60s cron).
 *
 * Key schema:
 *   vortex:presence:{userId}       — Redis Hash with status, socketId, lastHeartbeat, serverIds
 *   vortex:presence:server:{sId}   — Redis Set of online user IDs per server
 *
 * #595: WebSocket-Based Presence & Typing
 */

import Redis from "ioredis"
import pino from "pino"
import type { UserStatus } from "@vortex/shared"
import {
  PRESENCE_KEY_PREFIX,
  PRESENCE_TTL_SECONDS,
  PRESENCE_CLEANUP_INTERVAL_MS,
} from "@vortex/shared"

const log = pino({ name: "presence" })

export class PresenceManager {
  private readonly redis: Redis
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 })
  }

  private userKey(userId: string): string {
    return `${PRESENCE_KEY_PREFIX}:${userId}`
  }

  private serverKey(serverId: string): string {
    return `${PRESENCE_KEY_PREFIX}:server:${serverId}`
  }

  /** Mark a user as online when they connect via Socket.IO. */
  async setOnline(
    userId: string,
    socketId: string,
    status: UserStatus,
    serverIds: string[] = [],
  ): Promise<void> {
    try {
      const key = this.userKey(userId)
      const now = new Date().toISOString()

      const pipeline = this.redis.pipeline()
      pipeline.hset(key, {
        userId,
        status,
        socketId,
        lastHeartbeat: now,
        serverIds: JSON.stringify(serverIds),
      })
      pipeline.expire(key, PRESENCE_TTL_SECONDS)

      // Add user to all their server presence sets
      for (const serverId of serverIds) {
        pipeline.sadd(this.serverKey(serverId), userId)
        pipeline.expire(this.serverKey(serverId), PRESENCE_TTL_SECONDS * 2)
      }

      await pipeline.exec()
    } catch (err) {
      log.error({ err, userId }, "setOnline failed")
    }
  }

  /** Update a user's presence status (e.g. online → idle). */
  async updateStatus(userId: string, status: UserStatus): Promise<void> {
    try {
      const key = this.userKey(userId)
      const exists = await this.redis.exists(key)
      if (!exists) return

      await this.redis
        .pipeline()
        .hset(key, "status", status, "lastHeartbeat", new Date().toISOString())
        .expire(key, PRESENCE_TTL_SECONDS)
        .exec()
    } catch (err) {
      log.error({ err, userId }, "updateStatus failed")
    }
  }

  /** Remove a user's presence when they disconnect. */
  async setOffline(userId: string): Promise<string[]> {
    try {
      const key = this.userKey(userId)
      const data = await this.redis.hgetall(key)
      if (!data || !data.serverIds) return []

      let serverIds: string[] = []
      try {
        serverIds = JSON.parse(data.serverIds) as string[]
      } catch {
        serverIds = []
      }

      const pipeline = this.redis.pipeline()
      pipeline.del(key)
      for (const serverId of serverIds) {
        pipeline.srem(this.serverKey(serverId), userId)
      }
      await pipeline.exec()

      return serverIds
    } catch (err) {
      log.error({ err, userId }, "setOffline failed")
      return []
    }
  }

  /** Start periodic cleanup of stale presence entries.
   *  Uses cursor-based SCAN instead of blocking KEYS to avoid locking Redis.
   *
   *  This is a safety-net sweep only: it reaps orphaned keys that never got a
   *  TTL. The authoritative offline signal is the gateway's socket-disconnect
   *  handler, so no stale-user fan-out callback is needed here. */
  startCleanup(): void {
    if (this.cleanupTimer) return

    // TTL expiry is the primary cleanup mechanism; this sweep is a safety net
    // for orphaned keys (TTL === -1). Interval comes from the shared constant
    // so signal and any other consumer stay in lockstep.
    let cleanupInFlight = false
    this.cleanupTimer = setInterval(async () => {
      if (this.destroyed || cleanupInFlight) return
      cleanupInFlight = true
      try {
        let cursor = "0"
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            "MATCH",
            `${PRESENCE_KEY_PREFIX}:*`,
            "COUNT",
            100,
          )
          cursor = nextCursor

          for (const key of keys) {
            if (this.destroyed) return
            // Skip server set keys
            if (key.includes(":server:")) continue

            const ttl = await this.redis.ttl(key)
            if (ttl === -1) {
              // Key has no TTL — set one as safety net
              await this.redis.expire(key, PRESENCE_TTL_SECONDS)
            }
          }
        } while (cursor !== "0")
      } catch (err) {
        log.error({ err }, "presence cleanup sweep error")
      } finally {
        cleanupInFlight = false
      }
    }, PRESENCE_CLEANUP_INTERVAL_MS)
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    try {
      this.redis.disconnect()
    } catch {
      // Best-effort cleanup
    }
  }
}
