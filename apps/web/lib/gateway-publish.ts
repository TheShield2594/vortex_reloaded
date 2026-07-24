/**
 * Publishes events to the Socket.IO gateway's event bus.
 *
 * Called from API routes after a DB write so the gateway can fan-out
 * the event to subscribed clients in real time.
 *
 * #696: Consolidate dual real-time systems into single Socket.IO gateway.
 */

import { createLogger } from "@/lib/logger"
import type { VortexEventType } from "@vortex/shared"

const log = createLogger("gateway-publish")

const SIGNAL_URL = process.env.SIGNAL_SERVER_URL ?? process.env.NEXT_PUBLIC_SIGNAL_URL ?? "http://localhost:3001"
const SIGNAL_SECRET = process.env.SIGNAL_REVOKE_SECRET ?? ""

const PUBLISH_TIMEOUT_MS = 2000

interface GatewayEvent {
  type: VortexEventType
  channelId: string
  serverId?: string | null
  actorId: string
  data?: Record<string, unknown> | null
}

/**
 * Fire-and-forget publish to the gateway event bus.
 * Errors are logged but never thrown — gateway publish must not block the API response.
 */
export async function publishGatewayEvent(event: GatewayEvent, context?: { route?: string }): Promise<void> {
  if (!SIGNAL_SECRET) {
    log.warn({ action: event.type }, "SIGNAL_REVOKE_SECRET not configured — skipping gateway publish")
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS)

  try {
    const res = await fetch(`${SIGNAL_URL}/publish-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SIGNAL_SECRET}`,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)")
      log.error({ route: context?.route, userId: event.actorId, action: event.type, channelId: event.channelId, status: res.status, body }, "gateway publish failed")
    }
  } catch (err) {
    clearTimeout(timeout)
    log.error({ route: context?.route, userId: event.actorId, action: event.type, channelId: event.channelId, error: err }, "gateway publish error")
  }
}

/**
 * Revoke a user's live gateway sessions — call this when their sessions are
 * invalidated (password change, forced logout / session revocation, account
 * deletion). The signal server force-disconnects their connected socket(s)
 * and rejects any handshake JWT minted before this moment, so the change
 * takes effect immediately instead of lingering until the short-lived token
 * expires on its own (issue #52). A device whose Better Auth session is still
 * valid reconnects transparently with a freshly-minted token; a device whose
 * session was revoked can no longer mint one and stays out.
 *
 * Fire-and-forget: errors are logged but never thrown, so wiring this into an
 * auth flow can't break the underlying password-change / logout operation.
 */
export async function revokeGatewaySessions(userId: string): Promise<void> {
  if (!SIGNAL_SECRET) {
    log.warn({ action: "revoke-sessions" }, "SIGNAL_REVOKE_SECRET not configured — skipping gateway session revocation")
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS)

  try {
    const res = await fetch(`${SIGNAL_URL}/revoke-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SIGNAL_SECRET}`,
      },
      body: JSON.stringify({ userId }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)")
      log.error({ userId, status: res.status, body }, "gateway session revocation failed")
    }
  } catch (err) {
    clearTimeout(timeout)
    log.error({ userId, error: err }, "gateway session revocation error")
  }
}

/**
 * Force a user's already-connected socket(s) to leave a DM/group channel's
 * gateway room — call this when removing them as a member, before
 * publishing the member.left event, so a still-connected socket can't keep
 * receiving that channel's message/reaction events after being removed.
 */
export async function revokeGatewayChannelAccess(userId: string, channelId: string): Promise<void> {
  if (!SIGNAL_SECRET) {
    log.warn({ action: "revoke-channel-access" }, "SIGNAL_REVOKE_SECRET not configured — skipping gateway revoke")
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS)

  try {
    const res = await fetch(`${SIGNAL_URL}/revoke-channel-access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SIGNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, channelId }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)")
      log.error({ userId, channelId, status: res.status, body }, "gateway revoke failed")
    }
  } catch (err) {
    clearTimeout(timeout)
    log.error({ userId, channelId, error: err }, "gateway revoke error")
  }
}
