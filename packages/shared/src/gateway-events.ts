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

  /** DM/group call ring signaling (invite/cancel/accept/decline handshake). */
  "gateway:call-signal": {
    channelId: string
    type: "invite" | "cancel" | "accept" | "decline"
    withVideo?: boolean
    callerName?: string
    callerAvatar?: string | null
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

  /**
   * Typing indicator update for a channel.
   *
   * Carries only `userId` — never a display name. The signal server has no DB
   * access to resolve names, and relaying a client-supplied one would let any
   * channel member type under an arbitrary label (impersonation). Receivers
   * resolve the label locally from their own trusted channel-membership data.
   */
  "gateway:typing": {
    channelId: string
    userId: string
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
    /** Requested channels the server authorized and joined. */
    channelIds: string[]
    /**
     * Requested channels the server refused because the membership check
     * failed (issue #51). Lets the client reconcile its optimistic
     * subscription state instead of believing it joined a room it never did.
     */
    denied?: string[]
  }

  /** Resume complete — client is caught up. */
  "gateway:resume-complete": {
    /** Channels that were successfully replayed. */
    channels: string[]
    /** Channels where the gap was too large (client should full-reload). */
    gapTooLarge: string[]
  }

  /** DM/group call ring signaling, relayed to the other channel member(s). */
  "gateway:call-signal": {
    channelId: string
    type: "invite" | "cancel" | "accept" | "decline"
    /** The user who sent this signal. */
    userId: string
    withVideo?: boolean
    callerName?: string
    callerAvatar?: string | null
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Redis key prefix for event streams (per-channel). */
export const EVENT_STREAM_PREFIX = "vortex:stream"

/** Redis key prefix for presence state. */
export const PRESENCE_KEY_PREFIX = "vortex:presence"

/** Maximum events stored per channel stream. */
export const EVENT_STREAM_MAXLEN = 1000

/** Presence entry TTL in Redis (seconds). Offline detection = pingTimeout. */
export const PRESENCE_TTL_SECONDS = 30

/**
 * How often the server sweeps for stale presence entries (ms).
 * TTL expiry (PRESENCE_TTL_SECONDS) is the primary cleanup mechanism; this
 * sweep is only a safety net for orphaned keys with no TTL, so it runs
 * infrequently (5 min).
 */
export const PRESENCE_CLEANUP_INTERVAL_MS = 5 * 60_000

/** Maximum events replayed on reconnection per channel. */
export const MAX_REPLAY_EVENTS = 500

/** Rate limit for typing events (events/min). */
export const TYPING_RATE_LIMIT = 30

/** Rate limit for presence updates (events/min). */
export const PRESENCE_RATE_LIMIT = 12

/** Rate limit for call ring-signal events (events/min). */
export const CALL_SIGNAL_RATE_LIMIT = 20

/**
 * Rate limit for gateway:subscribe / gateway:resume (calls/min). Both now do
 * a network round-trip + DB query to authorize channel membership (issue #51),
 * so they're throttled to bound amplification against the internal endpoint.
 * Generous enough for legit connect + per-channel navigation.
 */
export const SUBSCRIBE_RATE_LIMIT = 30

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
