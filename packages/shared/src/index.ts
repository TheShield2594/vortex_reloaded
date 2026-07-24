// Shared types for Vortex

// ── Notification preferences ────────────────────────────────────────────────

/** Shape of user notification preferences stored in user_notification_preferences. */
export interface UserNotificationPreferences {
  mention_notifications: boolean
  reply_notifications: boolean
  friend_request_notifications: boolean
  server_invite_notifications: boolean
  system_notifications: boolean
  sound_enabled: boolean
  notification_volume: number
  suppress_everyone: boolean
  suppress_role_mentions: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_timezone: string
  push_notifications: boolean
  show_message_preview: boolean
  show_unread_badge: boolean
}

export {
  DECAY_CONSTANTS,
  RENEWAL_CONSTANTS,
  computeDecay,
  computeRenewalWindowDays,
  computeRenewalThresholdDays,
  maybeRenewExpiry,
} from './attachment-decay'
export type { DecayInput, DecayResult } from './attachment-decay'

export {
  PRESENCE_STALE_THRESHOLD_MS,
  PRESENCE_HEARTBEAT_DEBOUNCE_MS,
  IDLE_TIMEOUT_MS,
  IDLE_CHECK_INTERVAL_MS,
  ACTIVITY_THROTTLE_MS,
  aggregateStatus,
  PRESENCE_BROADCAST_CHANNEL,
  GATEWAY_OFFLINE_DETECTION_MS,
  GATEWAY_PING_INTERVAL_MS,
} from './presence'
export type { PresenceBroadcastMessage } from './presence'

export type {
  VortexEventType,
  VortexEvent,
  EventSubscription,
  SubscribeOptions,
  IEventBus,
} from './event-bus'

export type {
  GatewayClientEvents,
  GatewayServerEvents,
} from './gateway-events'

export {
  EVENT_STREAM_PREFIX,
  PRESENCE_KEY_PREFIX,
  EVENT_STREAM_MAXLEN,
  PRESENCE_TTL_SECONDS,
  PRESENCE_CLEANUP_INTERVAL_MS,
  MAX_REPLAY_EVENTS,
  TYPING_RATE_LIMIT,
  PRESENCE_RATE_LIMIT,
  CALL_SIGNAL_RATE_LIMIT,
  SUBSCRIBE_RATE_LIMIT,
  PERSISTED_EVENT_TYPES,
} from './gateway-events'

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline'

/** Game activity data stored in users.game_activity JSONB column. */
export interface GameActivity {
  game_name: string
  game_id?: string | null
  started_at?: string
  source?: string
}

/** Type guard for GameActivity JSONB values from the database. */
export function isGameActivity(value: unknown): value is GameActivity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).game_name === "string"
  )
}

// ── Client IP extraction ────────────────────────────────────────────────────

/**
 * Extract the client IP from request headers using a safe precedence order.
 *
 * Note: This function does not validate the immediate peer against a trusted
 * proxy list. In deployments behind a reverse proxy (Vercel, Cloudflare, nginx),
 * the proxy strips/overwrites these headers so spoofing is not possible.
 *
 * Precedence: x-forwarded-for (first entry) → cf-connecting-ip → x-real-ip
 * x-forwarded-for is preferred because it is the standard proxy header and
 * is reliably set/overwritten by Vercel, Cloudflare, and nginx.
 */
export function getClientIp(headers: { get(name: string): string | null }): string | null {
  const xForwardedFor = headers.get("x-forwarded-for")
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim()
    if (first) return first
  }

  const cfIp = headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp

  const xRealIp = headers.get("x-real-ip")?.trim()
  if (xRealIp) return xRealIp

  return null
}

/** Actions that can be triggered from the mobile header and consumed by ChatArea. */
export type MobileAction = "search" | "summary" | "pins" | "help"
