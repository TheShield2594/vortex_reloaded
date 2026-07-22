// Shared types for Vortex

export {
  AI_PROVIDERS,
  AI_PROVIDER_META,
  AI_FUNCTIONS,
  AI_FUNCTION_META,
} from './ai'
export type {
  AiProvider,
  AiFunction,
  AiProviderConfig,
  AiFunctionRouting,
  AiProviderConfigInput,
  AiFunctionRoutingInput,
  ResolvedAiProvider,
} from './ai'

export {
  DECAY_CONSTANTS,
  RENEWAL_CONSTANTS,
  computeDecay,
  computeRenewalWindowDays,
  computeRenewalThresholdDays,
  maybeRenewExpiry,
  extendExpiry,
  computeCost,
} from './attachment-decay'
export type { DecayInput, DecayResult } from './attachment-decay'

export {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
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
  PresenceEntry,
  StreamEvent,
} from './gateway-events'

export {
  EVENT_STREAM_PREFIX,
  PRESENCE_KEY_PREFIX,
  EVENT_STREAM_MAXLEN,
  EVENT_STREAM_TTL_SECONDS,
  PRESENCE_TTL_SECONDS,
  PRESENCE_CLEANUP_INTERVAL_MS,
  GATEWAY_PING_TIMEOUT_MS,
  MAX_REPLAY_EVENTS,
  GATEWAY_PUBLISH_RATE_LIMIT,
  TYPING_RATE_LIMIT,
  PRESENCE_RATE_LIMIT,
  PERSISTED_EVENT_TYPES,
  EPHEMERAL_EVENT_TYPES,
} from './gateway-events'

export const PERMISSIONS = {
  // General
  VIEW_CHANNELS:             1 << 0,   // 1
  SEND_MESSAGES:             1 << 1,   // 2
  MANAGE_MESSAGES:           1 << 2,   // 4
  KICK_MEMBERS:              1 << 3,   // 8
  BAN_MEMBERS:               1 << 4,   // 16
  MANAGE_ROLES:              1 << 5,   // 32
  MANAGE_CHANNELS:           1 << 6,   // 64
  ADMINISTRATOR:             1 << 7,   // 128
  // Voice
  CONNECT_VOICE:             1 << 8,   // 256
  SPEAK:                     1 << 9,   // 512
  MUTE_MEMBERS:              1 << 10,  // 1024
  STREAM:                    1 << 11,  // 2048
  // Extended — Discord-level parity
  MANAGE_WEBHOOKS:           1 << 12,  // 4096
  MANAGE_EVENTS:             1 << 13,  // 8192
  MODERATE_MEMBERS:          1 << 14,  // 16384 — timeout users
  CREATE_PUBLIC_THREADS:     1 << 15,  // 32768
  CREATE_PRIVATE_THREADS:    1 << 16,  // 65536
  SEND_MESSAGES_IN_THREADS:  1 << 17,  // 131072
  USE_APPLICATION_COMMANDS:  1 << 18,  // 262144
  MENTION_EVERYONE:          1 << 19,  // 524288
  MANAGE_EMOJIS:             1 << 20,  // 1048576
} as const

export type Permission = keyof typeof PERMISSIONS

/** Return the effective combined permission bitmask from a list of role bitmasks. */
export function computePermissions(roleBitmasks: number[]): number {
  return roleBitmasks.reduce((acc, p) => acc | p, 0)
}

export function hasPermission(permissions: number, permission: Permission): boolean {
  if (permissions & PERMISSIONS.ADMINISTRATOR) return true
  return !!(permissions & PERMISSIONS[permission])
}

export function addPermission(permissions: number, permission: Permission): number {
  return permissions | PERMISSIONS[permission]
}

export function removePermission(permissions: number, permission: Permission): number {
  return permissions & ~PERMISSIONS[permission]
}

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

// ── Discover API contract ──────────────────────────────────────────────────

/** A public server returned by the discover endpoint. */
export interface PublicServer {
  id: string
  name: string
  description: string | null
  icon_url: string | null
  member_count: number
  invite_code: string
  created_at: string
}

/** Response shape from GET /api/servers/discover. */
export interface DiscoverServersResponse {
  servers: PublicServer[]
  nextCursor: string | null
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

// ── Thread auto-archive ─────────────────────────────────────────────────────
/** Discord-compatible auto-archive duration options (in minutes). */
export const AUTO_ARCHIVE_OPTIONS = [
  { value: 60, label: "1 Hour" },
  { value: 1440, label: "24 Hours" },
  { value: 4320, label: "3 Days" },
  { value: 10080, label: "1 Week" },
] as const

export type AutoArchiveDuration = (typeof AUTO_ARCHIVE_OPTIONS)[number]["value"]

/** Set of valid auto-archive durations for server-side validation. */
export const VALID_AUTO_ARCHIVE_DURATIONS: ReadonlySet<number> = new Set(
  AUTO_ARCHIVE_OPTIONS.map((o) => o.value)
)

/** Default auto-archive duration (24 hours). */
export const DEFAULT_AUTO_ARCHIVE_DURATION: AutoArchiveDuration = 1440

export type ChannelType = 'text' | 'voice' | 'category' | 'forum' | 'stage' | 'announcement' | 'media'

/** Actions that can be triggered from the mobile header and consumed by ChatArea. */
export type MobileAction = "search" | "summary" | "pins" | "help"

/** Minimal user shape carried inside a voice-state row. */
export interface VoiceParticipantUser {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

/** A user currently connected to a voice/stage channel. */
export interface VoiceParticipant {
  user_id: string
  channel_id: string
  muted: boolean
  deafened: boolean
  user: VoiceParticipantUser | null
}

export interface SignalingEvents {
  'join-room': { channelId: string; userId: string; displayName: string; avatarUrl?: string }
  'leave-room': { channelId: string }
  'offer': { to: string; offer: RTCSessionDescriptionInit }
  'answer': { to: string; answer: RTCSessionDescriptionInit }
  'ice-candidate': { to: string; candidate: RTCIceCandidateInit }
  'toggle-mute': { muted: boolean }
  'toggle-deafen': { deafened: boolean }
  'speaking': { speaking: boolean }
}

export interface SignalingServerEvents {
  'room-peers': Array<{ peerId: string; userId: string; displayName: string; avatarUrl?: string; muted: boolean }>
  'peer-joined': { peerId: string; userId: string; displayName: string; avatarUrl?: string }
  'peer-left': { peerId: string; userId: string }
  'offer': { from: string; offer: RTCSessionDescriptionInit }
  'answer': { from: string; answer: RTCSessionDescriptionInit }
  'ice-candidate': { from: string; candidate: RTCIceCandidateInit }
  'peer-muted': { peerId: string; muted: boolean }
  'peer-deafened': { peerId: string; deafened: boolean }
  'peer-speaking': { peerId: string; speaking: boolean }
}

export type {
  UserNotificationPreferences,
  CuratedApp,
  CuratedSection,
  TrustBadgeType,
  TrustBadgeInfo,
  PermissionImpactLevel,
  PermissionMeta,
} from './marketplace'

export {
  TRUST_BADGE_INFO,
  APP_PERMISSION_META,
  getHighestImpact,
  requiresInstallConfirmation,
} from './marketplace'
