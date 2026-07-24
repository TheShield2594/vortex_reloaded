/**
 * Event Bus Abstraction Layer
 *
 * Provides a backend-agnostic interface for real-time event delivery: a
 * pluggable pub/sub system that supports fan-out and replay. The signal
 * gateway backs it with a Redis Streams adapter (`RedisEventBus` in
 * apps/signal/src/event-bus.ts).
 */

/** Well-known event types for the VortexChat real-time system. */
export type VortexEventType =
  | "message.created"
  | "message.updated"
  | "message.deleted"
  | "reaction.added"
  | "reaction.removed"
  | "typing.start"
  | "typing.stop"
  | "presence.update"
  | "member.joined"
  | "member.left"
  | "channel.updated"
  | "thread.created"
  | "thread.updated"
  | "notification.created"
  | "notification.updated"
  | "notification.deleted"

/** An event flowing through the bus. */
export interface VortexEvent<T = unknown> {
  /** Globally unique event ID (e.g. UUID v7 for ordering). */
  id: string
  /** Event type discriminator. */
  type: VortexEventType
  /**
   * Channel/scope this event belongs to. For per-user events with no
   * natural DM/group channel (e.g. `notification.created`, or a
   * `member.joined`/`member.left` notice to the affected user), this is
   * the synthetic `user:{userId}` channel — which the gateway restricts to
   * the owning user via its channel-access check (apps/signal/src/gateway.ts's
   * gateway:subscribe → apps/signal/src/channel-access.ts).
   */
  channelId: string
  /** Server context (null for DMs). */
  serverId: string | null
  /** User who triggered the event. */
  actorId: string
  /** Event-specific payload. */
  data: T
  /** ISO 8601 timestamp. */
  timestamp: string
}

/** Subscription handle returned by subscribe(). */
export interface EventSubscription {
  /** Stop receiving events. */
  unsubscribe(): void
}

/** Filter criteria for subscriptions. */
export interface SubscribeOptions {
  /** Only receive events for this channel. */
  channelId?: string
  /** Only receive these event types. */
  types?: VortexEventType[]
  /** Start replaying from this event ID (for catch-up after reconnect). */
  afterEventId?: string
}

/**
 * Core event bus interface.
 *
 * Backed by Redis Streams (`RedisEventBus`), or any other pub/sub system.
 */
export interface IEventBus {
  /**
   * Publish an event. Called by API routes after a successful DB write.
   * Returns the assigned event ID.
   */
  publish(event: Omit<VortexEvent, "id" | "timestamp">): Promise<string>

  /**
   * Subscribe to events matching the given filter.
   * The callback fires for each matching event.
   */
  subscribe(
    options: SubscribeOptions,
    callback: (event: VortexEvent) => void
  ): EventSubscription

  /**
   * Replay events after a given event ID (for reconnection catch-up).
   * Returns events in chronological order.
   */
  replay(options: {
    channelId: string
    afterEventId: string
    limit?: number
  }): Promise<VortexEvent[]>

  /** Clean up connections and resources. */
  destroy(): Promise<void>
}
