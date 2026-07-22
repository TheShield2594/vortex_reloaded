/**
 * Redis Streams–backed Event Bus implementation.
 *
 * Implements the IEventBus interface from @vortex/shared using Redis Streams
 * for durable event storage and replay, plus Redis pub/sub for real-time
 * fan-out across signal server replicas.
 *
 * Key schema:
 *   vortex:stream:{channelId}  — Redis Stream (capped at EVENT_STREAM_MAXLEN)
 *   vortex:pubsub:events       — Redis pub/sub channel for real-time fan-out
 *
 * #592: Unified Socket.IO Real-Time Gateway
 * #597: Reconnection Catch-Up Protocol
 */

import { randomUUID } from "crypto"
import Redis from "ioredis"
import pino from "pino"
import type {
  IEventBus,
  VortexEvent,
  VortexEventType,
  EventSubscription,
  SubscribeOptions,
} from "@vortex/shared"
import {
  EVENT_STREAM_PREFIX,
  EVENT_STREAM_MAXLEN,
  PERSISTED_EVENT_TYPES,
} from "@vortex/shared"

const log = pino({ name: "event-bus" })

const PUBSUB_CHANNEL = "vortex:pubsub:events"

type EventCallback = (event: VortexEvent) => void

interface Subscription {
  id: string
  options: SubscribeOptions
  callback: EventCallback
}

export class RedisEventBus implements IEventBus {
  private readonly redis: Redis
  private readonly pubClient: Redis
  private readonly subClient: Redis
  private subscriptions = new Map<string, Subscription>()
  private destroyed = false

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 })
    this.pubClient = new Redis(redisUrl, { maxRetriesPerRequest: 3 })
    this.subClient = new Redis(redisUrl, { maxRetriesPerRequest: 3 })

    this.subClient.subscribe(PUBSUB_CHANNEL).then(() => {
      log.info("event bus subscribed to pub/sub channel")
    }).catch((err: unknown) => {
      log.error({ err }, "failed to subscribe to event bus pub/sub channel")
    })

    this.subClient.on("message", (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as VortexEvent
        this.dispatchToSubscribers(event)
      } catch (err) {
        log.error({ err }, "failed to parse event bus pub/sub message")
      }
    })
  }

  private streamKey(channelId: string): string {
    return `${EVENT_STREAM_PREFIX}:${channelId}`
  }

  private dispatchToSubscribers(event: VortexEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (this.matchesFilter(event, sub.options)) {
        try {
          sub.callback(event)
        } catch (err) {
          log.error({ err, subscriptionId: sub.id }, "subscriber callback threw")
        }
      }
    }
  }

  private matchesFilter(event: VortexEvent, options: SubscribeOptions): boolean {
    if (options.channelId && event.channelId !== options.channelId) return false
    if (options.types && options.types.length > 0 && !options.types.includes(event.type)) return false
    return true
  }

  async publish(partial: Omit<VortexEvent, "id" | "timestamp">): Promise<string> {
    if (this.destroyed) throw new Error("EventBus is destroyed")

    const event: VortexEvent = {
      ...partial,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    }

    try {
      // Persist to Redis Stream if this is a persistable event type
      if (PERSISTED_EVENT_TYPES.has(partial.type)) {
        const key = this.streamKey(event.channelId)
        await this.redis.xadd(
          key,
          "MAXLEN",
          "~",
          String(EVENT_STREAM_MAXLEN),
          "*",
          "event",
          JSON.stringify(event),
        )
      }

      // Fan out to all replicas via pub/sub (always, for real-time delivery)
      await this.pubClient.publish(PUBSUB_CHANNEL, JSON.stringify(event))
    } catch (err) {
      log.error({ err, eventType: event.type, channelId: event.channelId }, "event publish failed")
      throw err
    }

    return event.id
  }

  subscribe(
    options: SubscribeOptions,
    callback: (event: VortexEvent) => void,
  ): EventSubscription {
    const id = randomUUID()
    this.subscriptions.set(id, { id, options, callback })

    return {
      unsubscribe: () => {
        this.subscriptions.delete(id)
      },
    }
  }

  async replay(options: {
    channelId: string
    afterEventId: string
    limit?: number
  }): Promise<VortexEvent[]> {
    if (this.destroyed) return []

    const key = this.streamKey(options.channelId)
    const limit = options.limit ?? 500

    try {
      // First, find the Redis stream entry ID for afterEventId so we can use
      // XRANGE with an exclusive start — O(log N) seek instead of O(N) scan.
      const streamEntryId = await this.findStreamEntryId(key, options.afterEventId)

      let entries: [string, string[]][]
      if (streamEntryId) {
        // Use exclusive range syntax: `(entryId` means "after this entry"
        // Redis XRANGE with `(` prefix is O(log N) for seeking.
        entries = await this.redis.xrange(key, `(${streamEntryId}`, "+", "COUNT", limit)
      } else {
        // afterEventId not found — gap too large. Return the latest events
        // so the caller can decide how to handle it.
        entries = await this.redis.xrange(key, "-", "+", "COUNT", limit)
      }

      if (!entries || entries.length === 0) return []

      const events: VortexEvent[] = []
      for (const [, fields] of entries) {
        if (!fields || fields.length < 2) continue
        try {
          events.push(JSON.parse(fields[1]) as VortexEvent)
        } catch {
          continue
        }
      }

      return events
    } catch (err) {
      log.error({ err, channelId: options.channelId }, "event replay failed")
      return []
    }
  }

  /**
   * Find the Redis stream entry ID for a given VortexEvent ID.
   *
   * Uses a reverse scan (XREVRANGE) limited to a reasonable window to avoid
   * scanning the entire stream. Returns null if the event is not found.
   */
  private async findStreamEntryId(key: string, eventId: string): Promise<string | null> {
    // Scan in reverse (newest first) since reconnection typically happens
    // shortly after the last event. Check in batches to bound memory usage.
    const BATCH_SIZE = 200
    let endId = "+"

    for (let attempt = 0; attempt < 5; attempt++) {
      const entries: [string, string[]][] = await this.redis.xrevrange(
        key, endId, "-", "COUNT", BATCH_SIZE,
      )
      if (!entries || entries.length === 0) return null

      for (const [streamId, fields] of entries) {
        if (!fields || fields.length < 2) continue
        try {
          const event = JSON.parse(fields[1]) as VortexEvent
          if (event.id === eventId) return streamId
        } catch {
          continue
        }
      }

      // Move cursor to just before the oldest entry in this batch
      const lastStreamId = entries[entries.length - 1][0]
      // Decrement the sequence to exclude this entry on the next iteration
      const [ms, seq] = lastStreamId.split("-")
      const prevSeq = parseInt(seq, 10) - 1
      endId = prevSeq >= 0 ? `${ms}-${prevSeq}` : `${parseInt(ms, 10) - 1}-99999`
    }

    return null
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.subscriptions.clear()

    try {
      this.subClient.disconnect()
      this.pubClient.disconnect()
      this.redis.disconnect()
    } catch {
      // Best-effort cleanup
    }
  }
}
