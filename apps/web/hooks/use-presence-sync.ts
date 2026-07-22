"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  IDLE_TIMEOUT_MS,
  IDLE_CHECK_INTERVAL_MS,
  ACTIVITY_THROTTLE_MS,
  PRESENCE_BROADCAST_CHANNEL,
  aggregateStatus,
  type UserStatus,
  type PresenceBroadcastMessage,
} from "@vortex/shared"

// ── Tab ID ───────────────────────────────────────────────────────────────────
// Unique per-tab identifier for multi-tab session tracking.
const TAB_ID = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the initial presence status from the DB-stored value. */
function resolveInitialStatus(status?: UserStatus): UserStatus {
  if (status === "dnd" || status === "invisible") return status
  // "idle" and "offline" from DB are transient — user is now active
  return "online"
}

/**
 * Compute the aggregated status for all tabs including this one.
 */
function computeAggregated(
  tabStatus: UserStatus,
  otherTabs: Map<string, UserStatus>
): UserStatus {
  const allStatuses: UserStatus[] = [tabStatus]
  for (const s of otherTabs.values()) {
    allStatuses.push(s)
  }
  return aggregateStatus(allStatuses)
}

/**
 * usePresenceSync — Reliable user presence tracking.
 *
 * Architecture (modeled after Fluxer):
 * 1. Server-side heartbeat: POST /api/presence/heartbeat every 30s so the
 *    server always knows which clients are alive. A cron job marks users
 *    with stale heartbeats as offline — this handles crashes, kills, and
 *    network drops that sendBeacon misses.
 *
 * 2. Multi-tab coordination via BroadcastChannel: tabs share their status
 *    so that closing one tab doesn't mark the user offline when other tabs
 *    remain open. Status is aggregated using Fluxer's precedence rules:
 *    online > dnd > idle > offline. Invisible overrides everything.
 *
 * 3. Idle detection: 10-minute timeout (Fluxer production value) with
 *    periodic checks at 25% intervals. Tab visibility changes trigger
 *    immediate idle (matching Discord/Slack behavior).
 *
 * 4. Supabase Realtime presence: still used for real-time distribution to
 *    other clients (member lists, profile indicators). The heartbeat system
 *    ensures the DB is always eventually consistent even if Realtime hiccups.
 */
export function usePresenceSync(userId: string | null, status?: UserStatus): void {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Current status for THIS tab
  const tabStatusRef = useRef<UserStatus>(resolveInitialStatus(status))
  // The user's explicit preference (dnd, invisible). null = no explicit
  // preference, so auto-idle and visibility changes behave normally.
  const explicitStatusRef = useRef<UserStatus | null>(
    status === "dnd" || status === "invisible" ? status : null
  )
  // Whether this tab is currently idle (auto-detected, not user-set)
  const autoIdleRef = useRef(false)
  // Aggregated status across all tabs — used for heartbeats so the server
  // always sees the combined multi-tab state.
  const aggregatedStatusRef = useRef<UserStatus>(resolveInitialStatus(status))

  const userIdRef = useRef<string | null>(null)
  const heartbeatTimerRef = useRef<number | undefined>(undefined)
  const idleCheckTimerRef = useRef<number | undefined>(undefined)
  const lastActivityRef = useRef(Date.now())
  const lastHeartbeatSentRef = useRef(0)

  // Track other tabs' statuses for aggregation
  const otherTabStatusesRef = useRef<Map<string, UserStatus>>(new Map())
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

  // Sync explicit status prop changes (e.g., user changes status in settings)
  useEffect(() => {
    // When user sets dnd/invisible, remember it. When they clear it (any
    // other status), reset so visibility-change handler doesn't restore stale values.
    explicitStatusRef.current =
      status === "dnd" || status === "invisible" ? status : null
    if (explicitStatusRef.current) {
      tabStatusRef.current = explicitStatusRef.current
    }
  }, [status])

  useEffect(() => {
    if (!userId) return
    userIdRef.current = userId

    // ── Broadcast & track to Supabase Realtime ─────────────────────────────
    function broadcastPresence(nextStatus: UserStatus): void {
      channelRef.current?.track({
        user_id: userId!,
        status: nextStatus,
        online_at: new Date().toISOString(),
      })
    }

    // ── Status update (local tab) ──────────────────────────────────────────
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

      // Compute aggregated status across all tabs
      const aggregated = computeAggregated(nextStatus, otherTabStatusesRef.current)
      aggregatedStatusRef.current = aggregated

      // Only broadcast + persist if the aggregated status actually changed
      if (aggregated === prevBroadcastedStatus) return
      prevBroadcastedStatus = aggregated

      broadcastPresence(aggregated)

      // Persist to DB (non-blocking)
      supabase
        .from("users")
        .update({ status: aggregated, updated_at: new Date().toISOString() })
        .eq("id", userId!)
        .then()
    }

    // ── BroadcastChannel for multi-tab coordination ────────────────────────
    try {
      const bc = new BroadcastChannel(PRESENCE_BROADCAST_CHANNEL)
      broadcastChannelRef.current = bc

      bc.onmessage = (event: MessageEvent<PresenceBroadcastMessage>) => {
        const msg = event.data
        if (!msg || typeof msg !== "object") return

        if (msg.type === "status-update" && msg.tabId !== TAB_ID) {
          // When we see a new peer for the first time, echo our status back
          // so it discovers us. This bootstraps peer state — a tab opened
          // after us will learn about us from this reply.
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
              // BroadcastChannel may be unavailable
            }
          }
          // Re-aggregate and broadcast if needed
          const aggregated = computeAggregated(tabStatusRef.current, otherTabStatusesRef.current)
          aggregatedStatusRef.current = aggregated
          if (aggregated !== prevBroadcastedStatus) {
            prevBroadcastedStatus = aggregated
            broadcastPresence(aggregated)
          }
        } else if (msg.type === "tab-closing" && msg.tabId !== TAB_ID) {
          otherTabStatusesRef.current.delete(msg.tabId)
          // Re-aggregate — the closing tab is gone
          const aggregated = computeAggregated(tabStatusRef.current, otherTabStatusesRef.current)
          aggregatedStatusRef.current = aggregated
          if (aggregated !== prevBroadcastedStatus) {
            prevBroadcastedStatus = aggregated
            broadcastPresence(aggregated)
            supabase
              .from("users")
              .update({ status: aggregated, updated_at: new Date().toISOString() })
              .eq("id", userId!)
              .then()
          }
        }
      }

      // Announce ourselves so existing tabs discover us
      bc.postMessage({
        type: "status-update",
        status: tabStatusRef.current,
        tabId: TAB_ID,
      } satisfies PresenceBroadcastMessage)
    } catch {
      // BroadcastChannel not supported — single-tab mode
    }

    // ── Heartbeat ──────────────────────────────────────────────────────────
    // Fluxer's gateway tracks session liveness via heartbeat ACKs. We achieve
    // the same by periodically POSTing to /api/presence/heartbeat. The server
    // updates last_heartbeat_at; a cron job marks stale entries as offline.
    async function sendHeartbeat(): Promise<void> {
      const now = Date.now()
      // Don't send if we just sent one (debounce)
      if (now - lastHeartbeatSentRef.current < PRESENCE_HEARTBEAT_INTERVAL_MS * 0.8) return
      lastHeartbeatSentRef.current = now

      // Use the aggregated multi-tab status so the server sees the combined
      // state, not just this tab's state. Prevents flapping between online/idle
      // when one tab is active and another is hidden.
      const currentStatus = aggregatedStatusRef.current
      // Don't heartbeat if aggregated status is offline
      if (currentStatus === "offline") return

      try {
        await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: currentStatus }),
          keepalive: true,
        })
      } catch {
        // Network error — the cron will handle stale detection
      }
    }

    // ── Idle detection (Fluxer-style) ──────────────────────────────────────
    // Fluxer's IdleStore checks at 25% intervals of the idle threshold.
    // We do the same: every 2.5 minutes, check if the user has been inactive
    // for 10 minutes.
    function checkIdle(): void {
      if (explicitStatusRef.current) return

      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed >= IDLE_TIMEOUT_MS) {
        if (tabStatusRef.current !== "idle") {
          setTabStatus("idle", { isAutoIdle: true })
        }
      }
    }

    // ── Activity tracking ──────────────────────────────────────────────────
    let lastActivityEventTime = 0

    function onActivity(): void {
      const now = Date.now()
      if (now - lastActivityEventTime < ACTIVITY_THROTTLE_MS) return
      lastActivityEventTime = now
      lastActivityRef.current = now

      // If we were auto-idle, go back to online
      if (autoIdleRef.current && tabStatusRef.current === "idle") {
        setTabStatus("online")
      }
    }

    function onVisibilityChange(): void {
      if (document.hidden) {
        // Tab hidden → mark as idle if currently online (Discord/Slack behavior)
        if (tabStatusRef.current === "online") {
          setTabStatus("idle", { isAutoIdle: true })
        }
        return
      }

      // Tab regained focus
      lastActivityRef.current = Date.now()

      if (explicitStatusRef.current) {
        // User has an explicit status set — restore it
        if (tabStatusRef.current !== explicitStatusRef.current) {
          setTabStatus(explicitStatusRef.current)
        }
        return
      }

      // Go back to online
      if (tabStatusRef.current !== "online") {
        setTabStatus("online")
      }
    }

    // ── Supabase Realtime presence channel ─────────────────────────────────
    const channel = supabase.channel("presence:global", {
      config: { presence: { key: userId } },
    })
    channelRef.current = channel

    channel
      .on("presence", { event: "sync" }, () => {})
      .subscribe(async (subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          const initialStatus = resolveInitialStatus(status)
          setTabStatus(initialStatus)
          // Send initial heartbeat immediately
          await sendHeartbeat()
        }
      })

    // ── Start timers ───────────────────────────────────────────────────────
    heartbeatTimerRef.current = window.setInterval(() => {
      sendHeartbeat()
    }, PRESENCE_HEARTBEAT_INTERVAL_MS)

    idleCheckTimerRef.current = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS)

    // ── Event listeners ────────────────────────────────────────────────────
    window.addEventListener("mousemove", onActivity)
    window.addEventListener("keydown", onActivity)
    window.addEventListener("pointerdown", onActivity)
    window.addEventListener("scroll", onActivity, { passive: true })
    document.addEventListener("visibilitychange", onVisibilityChange)

    // ── Tab close handler ──────────────────────────────────────────────────
    // Still use sendBeacon as a best-effort fast path. But the heartbeat
    // cron is the real safety net — if sendBeacon fails, the user gets
    // marked offline within 90s by the cron.
    function handleBeforeUnload(): void {
      // Notify other tabs that we're leaving
      try {
        broadcastChannelRef.current?.postMessage({
          type: "tab-closing",
          tabId: TAB_ID,
        } satisfies PresenceBroadcastMessage)
      } catch {
        // Ignore
      }

      // Check if other tabs are still open
      const otherTabCount = otherTabStatusesRef.current.size
      if (otherTabCount > 0) {
        // Other tabs are open — don't mark offline. The remaining tabs will
        // continue heartbeating and the aggregated status will be correct.
        channelRef.current?.untrack()
        return
      }

      // Last tab closing — mark offline via sendBeacon (fast path)
      channelRef.current?.untrack()
      try {
        const blob = new Blob(
          [JSON.stringify({ status: "offline" })],
          { type: "application/json" }
        )
        navigator.sendBeacon("/api/presence", blob)
      } catch {
        // sendBeacon failed — heartbeat cron will handle it within 90s
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = undefined
      }
      if (idleCheckTimerRef.current) {
        window.clearInterval(idleCheckTimerRef.current)
        idleCheckTimerRef.current = undefined
      }

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
        // Ignore
      }
      otherTabStatusesRef.current.clear()

      supabase.removeChannel(channel)
    }
  }, [userId, status, supabase])
}
