"use client"

/**
 * Socket.IO–based Presence Sync.
 *
 * Replaces HTTP heartbeat polling + Supabase Realtime presence with
 * Socket.IO connection-based presence detection. Offline detection drops
 * from ~90s to ~10s via Socket.IO pingTimeout.
 *
 * Still uses BroadcastChannel for multi-tab coordination (same Fluxer pattern).
 * The leader tab owns the Socket.IO connection; follower tabs sync via BC.
 *
 * #595: WebSocket-Based Presence & Typing
 */

import { useEffect, useRef } from "react"
import { useGatewayContext } from "./use-gateway-context"
import {
  IDLE_TIMEOUT_MS,
  IDLE_CHECK_INTERVAL_MS,
  ACTIVITY_THROTTLE_MS,
  PRESENCE_BROADCAST_CHANNEL,
  aggregateStatus,
  type UserStatus,
  type PresenceBroadcastMessage,
} from "@vortex/shared"

const TAB_ID = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`

function resolveInitialStatus(status?: UserStatus): UserStatus {
  if (status === "dnd" || status === "invisible") return status
  return "online"
}

function computeAggregated(
  tabStatus: UserStatus,
  otherTabs: Map<string, UserStatus>,
): UserStatus {
  const allStatuses: UserStatus[] = [tabStatus]
  for (const s of otherTabs.values()) allStatuses.push(s)
  return aggregateStatus(allStatuses)
}

export function useGatewayPresence(userId: string | null, status?: UserStatus): void {
  const gateway = useGatewayContext()

  const tabStatusRef = useRef<UserStatus>(resolveInitialStatus(status))
  const explicitStatusRef = useRef<UserStatus | null>(
    status === "dnd" || status === "invisible" ? status : null,
  )
  const autoIdleRef = useRef(false)
  const aggregatedStatusRef = useRef<UserStatus>(resolveInitialStatus(status))
  const lastActivityRef = useRef(Date.now())
  const otherTabStatusesRef = useRef<Map<string, UserStatus>>(new Map())
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    explicitStatusRef.current =
      status === "dnd" || status === "invisible" ? status : null
    if (explicitStatusRef.current) {
      tabStatusRef.current = explicitStatusRef.current
    }
  }, [status])

  useEffect(() => {
    if (!userId) return

    let prevBroadcastedStatus: UserStatus | null = null

    function setTabStatus(nextStatus: UserStatus, options?: { isAutoIdle?: boolean }): void {
      const isAutoIdle = options?.isAutoIdle ?? false
      tabStatusRef.current = nextStatus
      autoIdleRef.current = isAutoIdle && nextStatus === "idle"

      // Notify other tabs
      try {
        broadcastChannelRef.current?.postMessage({
          type: "status-update",
          status: nextStatus,
          tabId: TAB_ID,
        } satisfies PresenceBroadcastMessage)
      } catch {
        // BroadcastChannel may be unavailable
      }

      const aggregated = computeAggregated(nextStatus, otherTabStatusesRef.current)
      aggregatedStatusRef.current = aggregated

      if (aggregated === prevBroadcastedStatus) return
      prevBroadcastedStatus = aggregated

      // Send presence via Socket.IO gateway (replaces HTTP heartbeat)
      gateway.sendPresence(aggregated)
    }

    // ── BroadcastChannel for multi-tab coordination ────────────────────
    try {
      const bc = new BroadcastChannel(PRESENCE_BROADCAST_CHANNEL)
      broadcastChannelRef.current = bc

      bc.onmessage = (event: MessageEvent<PresenceBroadcastMessage>) => {
        const msg = event.data
        if (!msg || typeof msg !== "object") return

        if (msg.type === "status-update" && msg.tabId !== TAB_ID) {
          const isNewPeer = !otherTabStatusesRef.current.has(msg.tabId)
          otherTabStatusesRef.current.set(msg.tabId, msg.status)
          if (isNewPeer) {
            try {
              broadcastChannelRef.current?.postMessage({
                type: "status-update",
                status: tabStatusRef.current,
                tabId: TAB_ID,
              } satisfies PresenceBroadcastMessage)
            } catch {
              // ignore
            }
          }
          const aggregated = computeAggregated(tabStatusRef.current, otherTabStatusesRef.current)
          aggregatedStatusRef.current = aggregated
          if (aggregated !== prevBroadcastedStatus) {
            prevBroadcastedStatus = aggregated
            gateway.sendPresence(aggregated)
          }
        } else if (msg.type === "tab-closing" && msg.tabId !== TAB_ID) {
          otherTabStatusesRef.current.delete(msg.tabId)
          const aggregated = computeAggregated(tabStatusRef.current, otherTabStatusesRef.current)
          aggregatedStatusRef.current = aggregated
          if (aggregated !== prevBroadcastedStatus) {
            prevBroadcastedStatus = aggregated
            gateway.sendPresence(aggregated)
          }
        }
      }

      bc.postMessage({
        type: "status-update",
        status: tabStatusRef.current,
        tabId: TAB_ID,
      } satisfies PresenceBroadcastMessage)
    } catch {
      // BroadcastChannel not supported
    }

    // ── Idle detection ──────────────────────────────────────────────────
    function checkIdle(): void {
      if (explicitStatusRef.current) return
      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed >= IDLE_TIMEOUT_MS && tabStatusRef.current !== "idle") {
        setTabStatus("idle", { isAutoIdle: true })
      }
    }

    // ── Activity tracking ───────────────────────────────────────────────
    let lastActivityEventTime = 0
    function onActivity(): void {
      const now = Date.now()
      if (now - lastActivityEventTime < ACTIVITY_THROTTLE_MS) return
      lastActivityEventTime = now
      lastActivityRef.current = now
      if (autoIdleRef.current && tabStatusRef.current === "idle") {
        setTabStatus("online")
      }
    }

    function onVisibilityChange(): void {
      if (document.hidden) {
        if (tabStatusRef.current === "online") {
          setTabStatus("idle", { isAutoIdle: true })
        }
        return
      }
      lastActivityRef.current = Date.now()
      if (explicitStatusRef.current) {
        if (tabStatusRef.current !== explicitStatusRef.current) {
          setTabStatus(explicitStatusRef.current)
        }
        return
      }
      if (tabStatusRef.current !== "online") {
        setTabStatus("online")
      }
    }

    // Set initial status via gateway
    const initialStatus = resolveInitialStatus(status)
    setTabStatus(initialStatus)

    // ── Timers and listeners ────────────────────────────────────────────
    const idleCheckTimer = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS)

    window.addEventListener("mousemove", onActivity)
    window.addEventListener("keydown", onActivity)
    window.addEventListener("pointerdown", onActivity)
    window.addEventListener("scroll", onActivity, { passive: true })
    document.addEventListener("visibilitychange", onVisibilityChange)

    function handleBeforeUnload(): void {
      try {
        broadcastChannelRef.current?.postMessage({
          type: "tab-closing",
          tabId: TAB_ID,
        } satisfies PresenceBroadcastMessage)
      } catch {
        // ignore
      }

      // Socket.IO disconnect will handle offline detection automatically
      // via pingTimeout on the server (~10s). No sendBeacon needed.
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      window.clearInterval(idleCheckTimer)
      window.removeEventListener("mousemove", onActivity)
      window.removeEventListener("keydown", onActivity)
      window.removeEventListener("pointerdown", onActivity)
      window.removeEventListener("scroll", onActivity)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("beforeunload", handleBeforeUnload)

      try {
        broadcastChannelRef.current?.close()
        broadcastChannelRef.current = null
      } catch {
        // ignore
      }
      otherTabStatusesRef.current.clear()
    }
  }, [userId, status, gateway])
}
