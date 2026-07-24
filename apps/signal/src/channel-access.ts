/**
 * Channel-membership authorization for the gateway.
 *
 * `gateway:subscribe` / `gateway:resume` must only let a socket join rooms the
 * user is actually a member of. Two channel shapes flow through the gateway:
 *
 *   - `user:{id}` synthetic per-user channels — owner-only, resolved locally.
 *   - DM/group channel IDs — membership is authoritative in the web app's
 *     database, so those are verified via an authenticated call to its
 *     internal endpoint (POST /api/internal/gateway/channel-access).
 *
 * Fixes issue #51: previously the gateway joined any requested room, so any
 * authenticated user who obtained a channel ID received another DM's live
 * `message.created` events (which carry plaintext content).
 */

import pino from "pino"

const log = pino({ name: "channel-access" })

const USER_CHANNEL_PREFIX = "user:"
const DEFAULT_TIMEOUT_MS = 2000

export interface ChannelAccessConfig {
  /**
   * Base URL of apps/web, reachable from wherever apps/signal runs (same host
   * as AUTH_JWKS_URL — e.g. the Docker/Compose service name, not necessarily
   * the public browser origin). No trailing slash.
   */
  webAppUrl: string
  /** Shared secret (SIGNAL_REVOKE_SECRET) sent as a Bearer token. */
  secret: string
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number
}

/** Returns the subset of `channelIds` the user is authorized to join. */
export type CheckChannelAccess = (userId: string, channelIds: string[]) => Promise<string[]>

/**
 * Build the membership authorizer used by the gateway.
 *
 * `user:{id}` channels are always resolved locally (owner-only), independent
 * of configuration. DM/group channels are verified against the web app.
 *
 * Fails CLOSED for DM channels: when the endpoint is unreachable, errors, or
 * returns a malformed response, the affected channels are denied for this
 * attempt (the client re-subscribes on its next reconnect). This is what makes
 * revocation actually stick — a removed member re-emitting `gateway:subscribe`
 * is re-checked and rejected instead of silently rejoining the room.
 *
 * Pass `null` to disable the DM membership backend (local dev without apps/web
 * wired up): DM channels are then allowed with a warning, mirroring how
 * validateSession skips when no JWKS is configured. The `user:{id}` ownership
 * check still applies in that mode.
 */
export function createChannelAccessChecker(config: ChannelAccessConfig | null): CheckChannelAccess {
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!config) {
    log.warn("channel access checker unconfigured — DM channel subscriptions will not be authorized (dev only)")
  }

  return async function checkChannelAccess(userId: string, channelIds: string[]): Promise<string[]> {
    const allowed: string[] = []
    const dmChannelIds: string[] = []

    for (const id of channelIds) {
      if (id.startsWith(USER_CHANNEL_PREFIX)) {
        // Synthetic per-user channel — only the owning user may join it.
        if (id.slice(USER_CHANNEL_PREFIX.length) === userId) allowed.push(id)
      } else {
        dmChannelIds.push(id)
      }
    }

    if (dmChannelIds.length === 0) return allowed

    // No membership backend configured — dev parity with validateSession's
    // skip-when-unconfigured behavior. The user:{id} check above still ran.
    if (!config) return [...allowed, ...dmChannelIds]

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await fetch(`${config.webAppUrl}/api/internal/gateway/channel-access`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.secret}`,
          },
          body: JSON.stringify({ userId, channelIds: dmChannelIds }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        log.error({ userId, status: res.status }, "channel access check failed — denying DM channels")
        return allowed
      }

      const data = (await res.json()) as { allowed?: unknown }
      if (!Array.isArray(data.allowed)) {
        log.error({ userId }, "channel access check returned malformed response — denying DM channels")
        return allowed
      }

      const granted = new Set(data.allowed.filter((id): id is string => typeof id === "string"))
      for (const id of dmChannelIds) {
        if (granted.has(id)) allowed.push(id)
      }
      return allowed
    } catch (err) {
      log.error({ userId, err }, "channel access check errored — denying DM channels")
      return allowed
    }
  }
}
