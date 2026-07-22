import Redis from "ioredis"
import type { PeerInfo, IRoomManager } from "./rooms"

/**
 * Redis-backed room manager.
 *
 * Key schema
 * ──────────
 *   vortex:room:{channelId}        Redis Hash  field=socketId  value=JSON(PeerInfo)
 *   vortex:socket:{socketId}       Redis Set   members=channelIds this socket joined
 *
 * Room state is therefore durable across process restarts and shared across
 * multiple signal-server replicas pointing at the same Redis instance.
 *
 * Note: after a restart all existing WebSocket connections are dropped and
 * clients must reconnect.  Stale socket entries left in Redis from the
 * previous process are cleaned up automatically when those sockets call
 * join-room or disconnect again, and are ignored by new peers (they won't
 * receive WebRTC offers because the old socket IDs no longer exist in
 * Socket.IO).  For a production deployment you may additionally set a TTL
 * on room keys via REDIS_ROOM_TTL_SECONDS if you want automatic eviction.
 */
export class RedisRoomManager implements IRoomManager {
  readonly redis: Redis
  private readonly roomPrefix = "vortex:room"
  private readonly socketPrefix = "vortex:socket"
  /** TTL in seconds applied to room and socket keys for crash recovery cleanup. */
  private readonly keyTtlSeconds: number

  constructor(redisUrl: string, keyTtlSeconds = 300) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    })
    this.keyTtlSeconds = keyTtlSeconds
  }

  private roomKey(channelId: string): string {
    return `${this.roomPrefix}:${channelId}`
  }

  private socketKey(socketId: string): string {
    return `${this.socketPrefix}:${socketId}`
  }

  private serialize(info: PeerInfo): string {
    return JSON.stringify({ ...info, joinedAt: info.joinedAt.toISOString() })
  }

  private deserialize(raw: string): PeerInfo {
    const parsed = JSON.parse(raw) as PeerInfo & { joinedAt: string }
    return { ...parsed, joinedAt: new Date(parsed.joinedAt) }
  }

  async join(channelId: string, info: PeerInfo): Promise<PeerInfo[]> {
    const rKey = this.roomKey(channelId)
    const sKey = this.socketKey(info.socketId)

    // Fetch existing peers before adding the new one
    const existing = await this.getRoomPeers(channelId)

    // Persist peer into the room hash and record the socket→channel mapping.
    // Apply TTL so stale keys from crashed processes auto-expire.
    // Use MULTI/EXEC to ensure the socket key exists before any concurrent
    // getRoomPeers() call can check it and classify the peer as stale.
    await this.redis
      .multi()
      .sadd(sKey, channelId)
      .expire(sKey, this.keyTtlSeconds)
      .hset(rKey, info.socketId, this.serialize(info))
      .expire(rKey, this.keyTtlSeconds)
      .exec()

    return existing
  }

  /**
   * Refresh TTL on all keys owned by the given socket.
   * Call this periodically (e.g. on ping or heartbeat) to keep active
   * sessions alive while allowing crashed sessions to auto-expire.
   */
  async refreshTtl(socketId: string): Promise<void> {
    try {
      const sKey = this.socketKey(socketId)
      const channelIds = await this.redis.smembers(sKey)
      if (channelIds.length === 0) return

      const pipeline = this.redis.pipeline()
      pipeline.expire(sKey, this.keyTtlSeconds)
      for (const channelId of channelIds) {
        pipeline.expire(this.roomKey(channelId), this.keyTtlSeconds)
      }
      await pipeline.exec()
    } catch (err) {
      console.error("[RedisRoomManager] refreshTtl failed", { socketId, err })
      throw err
    }
  }

  async leave(channelId: string, socketId: string): Promise<void> {
    const rKey = this.roomKey(channelId)
    const sKey = this.socketKey(socketId)

    await Promise.all([
      this.redis.hdel(rKey, socketId),
      this.redis.srem(sKey, channelId),
    ])

    // Clean up the room key when empty
    const remaining = await this.redis.hlen(rKey)
    if (remaining === 0) await this.redis.del(rKey)
  }

  async leaveAll(socketId: string): Promise<{ channelId: string; userId: string }[]> {
    const sKey = this.socketKey(socketId)
    const channelIds = await this.redis.smembers(sKey)

    const left: { channelId: string; userId: string }[] = []

    await Promise.all(
      channelIds.map(async (channelId) => {
        const rKey = this.roomKey(channelId)
        const raw = await this.redis.hget(rKey, socketId)
        if (raw) {
          const peer = this.deserialize(raw)
          left.push({ channelId, userId: peer.userId })
          await this.redis.hdel(rKey, socketId)
          const remaining = await this.redis.hlen(rKey)
          if (remaining === 0) await this.redis.del(rKey)
        }
      })
    )

    await this.redis.del(sKey)
    return left
  }

  async updatePeer(channelId: string, socketId: string, updates: Partial<PeerInfo>): Promise<void> {
    const rKey = this.roomKey(channelId)
    const raw = await this.redis.hget(rKey, socketId)
    if (!raw) return
    const peer = this.deserialize(raw)
    await this.redis.hset(rKey, socketId, this.serialize({ ...peer, ...updates }))
  }

  async getPeer(channelId: string, socketId: string): Promise<PeerInfo | undefined> {
    const raw = await this.redis.hget(this.roomKey(channelId), socketId)
    return raw ? this.deserialize(raw) : undefined
  }

  async getRoomPeers(channelId: string): Promise<PeerInfo[]> {
    const rKey = this.roomKey(channelId)
    const hash = await this.redis.hgetall(rKey)
    if (!hash || Object.keys(hash).length === 0) return []

    const entries = Object.entries(hash)
    if (entries.length === 0) return []

    // Batch EXISTS checks in a single pipeline (one RTT for all sockets)
    const checkPipeline = this.redis.pipeline()
    for (const [socketId] of entries) {
      checkPipeline.exists(this.socketKey(socketId))
    }
    const existsResults = await checkPipeline.exec()

    const peers: PeerInfo[] = []
    const staleSocketIds: string[] = []

    for (let i = 0; i < entries.length; i++) {
      const [socketId, raw] = entries[i]
      const exists = existsResults?.[i]?.[1] === 1
      if (exists) {
        peers.push(this.deserialize(raw))
      } else {
        staleSocketIds.push(socketId)
      }
    }

    // Clean up stale entries
    if (staleSocketIds.length > 0) {
      try {
        const cleanupPipeline = this.redis.pipeline()
        for (const socketId of staleSocketIds) {
          cleanupPipeline.hdel(rKey, socketId)
        }
        await cleanupPipeline.exec()
      } catch (err) {
        console.error("[RedisRoomManager] stale peer cleanup failed", { channelId, staleSocketIds, err })
      }
    }

    return peers
  }

  async getRoomSize(channelId: string): Promise<number> {
    return this.redis.hlen(this.roomKey(channelId))
  }

  async getStats(): Promise<Record<string, number>> {
    const keys = await this.redis.keys(`${this.roomPrefix}:*`)
    const stats: Record<string, number> = {}
    await Promise.all(
      keys.map(async (key) => {
        const channelId = key.slice(this.roomPrefix.length + 1)
        stats[channelId] = await this.redis.hlen(key)
      })
    )
    return stats
  }
}
