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

export interface PresenceData {
  userId: string
  status: UserStatus
  socketId: string
  lastHeartbeat: string
  serverIds: string[]
}

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
    serverIds: string[],
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

  /** Refresh the heartbeat TTL for a user. Called on Socket.IO ping. */
  async heartbeat(userId: string): Promise<void> {
    try {
      const key = this.userKey(userId)
      await this.redis
        .pipeline()
        .hset(key, "lastHeartbeat", new Date().toISOString())
        .expire(key, PRESENCE_TTL_SECONDS)
        .exec()
    } catch (err) {
      log.error({ err, userId }, "heartbeat failed")
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

  /** Get presence data for a specific user. */
  async getPresence(userId: string): Promise<PresenceData | null> {
    try {
      const data = await this.redis.hgetall(this.userKey(userId))
      if (!data || !data.userId) return null

      return {
        userId: data.userId,
        status: data.status as UserStatus,
        socketId: data.socketId,
        lastHeartbeat: data.lastHeartbeat,
        serverIds: JSON.parse(data.serverIds || "[]") as string[],
      }
    } catch (err) {
      log.error({ err, userId }, "getPresence failed")
      return null
    }
  }

  /** Get all online user IDs for a server. */
  async getServerOnlineUsers(serverId: string): Promise<string[]> {
    try {
      return await this.redis.smembers(this.serverKey(serverId))
    } catch (err) {
      log.error({ err, serverId }, "getServerOnlineUsers failed")
      return []
    }
  }

  /** Get presence for multiple users (batch). */
  async getMultiplePresence(userIds: string[]): Promise<Map<string, PresenceData>> {
    const result = new Map<string, PresenceData>()
    if (userIds.length === 0) return result

    try {
      const pipeline = this.redis.pipeline()
      for (const userId of userIds) {
        pipeline.hgetall(this.userKey(userId))
      }
      const results = await pipeline.exec()
      if (!results) return result

      for (let i = 0; i < userIds.length; i++) {
        const [err, data] = results[i] as [Error | null, Record<string, string>]
        if (err || !data || !data.userId) continue
        result.set(userIds[i], {
          userId: data.userId,
          status: data.status as UserStatus,
          socketId: data.socketId,
          lastHeartbeat: data.lastHeartbeat,
          serverIds: JSON.parse(data.serverIds || "[]") as string[],
        })
      }
    } catch (err) {
      log.error({ err }, "getMultiplePresence failed")
    }

    return result
  }

  /** Start periodic cleanup of stale presence entries.
   *  Uses cursor-based SCAN instead of blocking KEYS to avoid locking Redis. */
  startCleanup(onStaleUser: (userId: string, serverIds: string[]) => void): void {
    if (this.cleanupTimer) return

    // Use 5-minute interval — TTL expiry is the primary cleanup mechanism;
    // this sweep is a safety net for orphaned keys (TTL === -1).
    const CLEANUP_INTERVAL_MS = 5 * 60_000

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
    }, CLEANUP_INTERVAL_MS)
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
