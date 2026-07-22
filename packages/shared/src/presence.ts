/**
 * Presence constants and utilities.
 *
 * Modeled after Fluxer's presence system:
 * - Server-side heartbeat validation (client pings, server detects staleness)
 * - Status precedence for multi-session aggregation
 * - Idle detection with configurable timeout
 */

import type { UserStatus } from './index'

// ── Heartbeat ────────────────────────────────────────────────────────────────

/** How often the client sends a heartbeat (ms).
 *  Legacy HTTP polling: 30s. Gateway (Socket.IO): handled by pingInterval. */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000

/** Server considers a user stale after this many ms without a heartbeat.
 *  Legacy HTTP: 90s (30s heartbeat + 60s cron). Gateway: ~10s (Socket.IO pingTimeout). */
export const PRESENCE_STALE_THRESHOLD_MS = 90_000

/** Minimum interval between DB writes for heartbeat (ms). Prevents stampede. */
export const PRESENCE_HEARTBEAT_DEBOUNCE_MS = 10_000

// ── Gateway Presence (Socket.IO–based, faster) ─────────────────────────────

/** Socket.IO pingTimeout — offline detected within this window. */
export const GATEWAY_OFFLINE_DETECTION_MS = 20_000

/** Socket.IO pingInterval — server pings clients at this rate. */
export const GATEWAY_PING_INTERVAL_MS = 25_000

// ── Idle detection ───────────────────────────────────────────────────────────

/** Idle timeout: mark user idle after this many ms of inactivity.
 *  Fluxer uses 10 minutes in production. */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000

/** How often the idle checker runs (25% of idle timeout, matching Fluxer). */
export const IDLE_CHECK_INTERVAL_MS = Math.floor(IDLE_TIMEOUT_MS * 0.25)

/** Throttle activity events to prevent excessive processing. */
export const ACTIVITY_THROTTLE_MS = 3_000

// ── Status precedence ────────────────────────────────────────────────────────

/**
 * Status precedence for multi-session aggregation (Fluxer pattern).
 * When a user has multiple tabs/devices, the highest-precedence status wins.
 * Lower index = higher precedence.
 *
 * Invisible is special: it overrides everything (user explicitly hiding).
 */
const STATUS_PRECEDENCE: UserStatus[] = ['online', 'dnd', 'idle', 'offline']

/**
 * Aggregate status across multiple sessions.
 * Returns the highest-precedence visible status, or 'invisible' if any
 * session is invisible (matching Fluxer's absolute invisible override).
 */
export function aggregateStatus(statuses: UserStatus[]): UserStatus {
  if (statuses.length === 0) return 'offline'
  if (statuses.includes('invisible')) return 'invisible'

  let best: UserStatus = 'offline'
  let bestIndex = STATUS_PRECEDENCE.indexOf('offline')

  for (const s of statuses) {
    const idx = STATUS_PRECEDENCE.indexOf(s)
    if (idx !== -1 && idx < bestIndex) {
      best = s
      bestIndex = idx
    }
  }

  return best
}

// ── BroadcastChannel ─────────────────────────────────────────────────────────

/** Channel name for cross-tab presence coordination. */
export const PRESENCE_BROADCAST_CHANNEL = 'vortex:presence'

/** Message types for cross-tab communication. */
export type PresenceBroadcastMessage =
  | { type: 'status-update'; status: UserStatus; tabId: string }
  | { type: 'heartbeat-ack'; tabId: string }
  | { type: 'tab-closing'; tabId: string }
