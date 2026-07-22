/**
 * Event Bus Abstraction Layer
 *
 * Provides a backend-agnostic interface for real-time event delivery.
 * Replaces direct Supabase Realtime subscriptions with a pluggable
 * event system that supports fan-out, delivery guarantees, and replay.
 *
 * Phase 1: Interface + Supabase adapter (current)
 * Phase 2: Redis Streams backend (future)
 * Phase 3: Delivery receipts + per-user ack tracking (future)
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
  | "voice.peer_joined"
  | "voice.peer_left"
  | "voice.state_changed"

/** An event flowing through the bus. */
export interface VortexEvent<T = unknown> {
  /** Globally unique event ID (e.g. UUID v7 for ordering). */
  id: string
  /** Event type discriminator. */
  type: VortexEventType
  /** Channel/scope this event belongs to. */
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
 * Implementations can be backed by Supabase Realtime (current),
 * Redis Streams (Phase 2), or any other pub/sub system.
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

  /**
   * Acknowledge receipt of an event for a given user.
   * Used for delivery receipts (Phase 3).
   */
  acknowledge?(userId: string, eventId: string): Promise<void>

  /** Clean up connections and resources. */
  destroy(): Promise<void>
}
