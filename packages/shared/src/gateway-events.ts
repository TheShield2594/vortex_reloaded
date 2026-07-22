/**
 * Gateway Event Types for the Unified Socket.IO Real-Time Gateway.
 *
 * All real-time events (messages, reactions, typing, presence) flow through
 * Socket.IO instead of Supabase Realtime. The signal server acts as the
 * single gateway, using Redis pub/sub for multi-instance fan-out.
 *
 * Related issues:
 * - #592: Unified Socket.IO Real-Time Gateway
 * - #595: WebSocket-Based Presence & Typing
 * - #597: Reconnection Catch-Up Protocol
 */

import type { VortexEvent, VortexEventType } from "./event-bus"
import type { UserStatus } from "./index"

// ── Client → Server Events ──────────────────────────────────────────────────

export interface GatewayClientEvents {
  /** Subscribe to real-time events for specific channels. */
  "gateway:subscribe": {
    channelIds: string[]
  }

  /** Unsubscribe from channel events. */
  "gateway:unsubscribe": {
    channelIds: string[]
  }

  /** Typing indicator start/stop. */
  "gateway:typing": {
    channelId: string
    isTyping: boolean
  }

  /** Presence heartbeat — replaces HTTP polling. */
  "gateway:presence": {
    status: UserStatus
  }

  /**
   * Resume after reconnection — replay missed events.
   * Client sends the last event ID it received for each channel.
   */
  "gateway:resume": {
    /** Map of channelId → lastEventId the client received. */
    channels: Record<string, string>
  }
}

// ── Server → Client Events ──────────────────────────────────────────────────

export interface GatewayServerEvents {
  /** A real-time event delivered to the client. */
  "gateway:event": VortexEvent

  /** Batch of events replayed after reconnection. */
  "gateway:replay": {
    channelId: string
    events: VortexEvent[]
    /** True if more events exist beyond the replayed batch (gap > buffer). */
    hasMore: boolean
  }

  /** Typing indicator update for a channel. */
  "gateway:typing": {
    channelId: string
    userId: string
    displayName: string
    isTyping: boolean
  }

  /** Presence update for a user. */
  "gateway:presence": {
    userId: string
    status: UserStatus
    /** ISO 8601 timestamp of the update. */
    updatedAt: string
  }

  /** Acknowledgement that subscription was successful. */
  "gateway:subscribed": {
    channelIds: string[]
  }

  /** Resume complete — client is caught up. */
  "gateway:resume-complete": {
    /** Channels that were successfully replayed. */
    channels: string[]
    /** Channels where the gap was too large (client should full-reload). */
    gapTooLarge: string[]
  }
}

// ── Presence Data Structures ────────────────────────────────────────────────

export interface PresenceEntry {
  userId: string
  status: UserStatus
  socketId: string
  /** ISO 8601 timestamp of last heartbeat. */
  lastHeartbeat: string
  /** Server IDs the user is a member of (for scoped presence broadcasts). */
  serverIds: string[]
}

// ── Redis Stream Event Wrapper ──────────────────────────────────────────────

export interface StreamEvent {
  /** Redis Stream entry ID (e.g. "1234567890-0"). */
  streamId: string
  /** The VortexEvent serialized as JSON. */
  event: VortexEvent
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Redis key prefix for event streams (per-channel). */
export const EVENT_STREAM_PREFIX = "vortex:stream"

/** Redis key prefix for presence state. */
export const PRESENCE_KEY_PREFIX = "vortex:presence"

/** Maximum events stored per channel stream. */
export const EVENT_STREAM_MAXLEN = 1000

/** TTL for event stream entries (24 hours in seconds). */
export const EVENT_STREAM_TTL_SECONDS = 86_400

/** Presence entry TTL in Redis (seconds). Offline detection = pingTimeout. */
export const PRESENCE_TTL_SECONDS = 30

/** How often the server checks for stale presence entries (ms). */
export const PRESENCE_CLEANUP_INTERVAL_MS = 10_000

/** Socket.IO pingTimeout for presence-based offline detection (ms). */
export const GATEWAY_PING_TIMEOUT_MS = 20_000

/** Maximum events replayed on reconnection per channel. */
export const MAX_REPLAY_EVENTS = 500

/** Rate limit for gateway event publishing (events/min). */
export const GATEWAY_PUBLISH_RATE_LIMIT = 60

/** Rate limit for typing events (events/min). */
export const TYPING_RATE_LIMIT = 30

/** Rate limit for presence updates (events/min). */
export const PRESENCE_RATE_LIMIT = 12

/** Well-known event types that should be stored in Redis Streams. */
export const PERSISTED_EVENT_TYPES: ReadonlySet<VortexEventType> = new Set([
  "message.created",
  "message.updated",
  "message.deleted",
  "reaction.added",
  "reaction.removed",
  "thread.created",
  "thread.updated",
  "member.joined",
  "member.left",
  "channel.updated",
])

/** Ephemeral event types that are broadcast but not persisted. */
export const EPHEMERAL_EVENT_TYPES: ReadonlySet<VortexEventType> = new Set([
  "typing.start",
  "typing.stop",
  "presence.update",
  "voice.peer_joined",
  "voice.peer_left",
  "voice.state_changed",
])
