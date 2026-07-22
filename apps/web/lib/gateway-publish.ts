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
