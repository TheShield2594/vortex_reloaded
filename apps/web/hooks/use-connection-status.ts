"use client"

import { useEffect, useSyncExternalStore, useCallback } from "react"

export type ConnectionState = "connected" | "disconnected" | "reconnecting" | "offline"

// --- External store (singleton) ---------------------------------------------------

/** The state visible to the UI (delayed by grace period for transient disconnects). */
let visibleState: ConnectionState = "connected"
/** The real FSM state (updated immediately). */
let internalState: ConnectionState = "connected"
const listeners = new Set<() => void>()

/** Grace period before surfacing a disconnect to the UI (ms).
 *  If reconnection completes within this window the user never sees a banner. */
const GRACE_PERIOD_MS = 2500
let graceTimer: ReturnType<typeof setTimeout> | undefined

function setVisibleState(next: ConnectionState): void {
  if (next === visibleState) return
  visibleState = next
  for (const l of listeners) l()
}

function cancelGrace(): void {
  if (graceTimer) {
    clearTimeout(graceTimer)
    graceTimer = undefined
  }
}

/** Transition the FSM.  "connected" is applied immediately (and cancels any
 *  pending grace timer).  All other states are deferred by the grace period so
 *  transient reconnections stay invisible to the user. */
function setState(next: ConnectionState): void {
  internalState = next

  if (next === "connected") {
    // Good news — show immediately & cancel any pending degraded-state reveal.
    cancelGrace()
    setVisibleState("connected")
    return
  }

  // For non-connected states, only surface after the grace period.
  // If a grace timer is already ticking, let it run — the latest internal
  // state will be picked up when it fires.
  if (!graceTimer) {
    graceTimer = setTimeout(() => {
      graceTimer = undefined
      // Reveal whatever the current internal state is (it may have changed
      // since the timer was scheduled).
      if (internalState !== "connected") {
        setVisibleState(internalState)
      }
    }, GRACE_PERIOD_MS)
  }
}

function getSnapshot(): ConnectionState {
  return visibleState
}

function getServerSnapshot(): ConnectionState {
  return "connected"
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// --- Reconnection with exponential back-off ---------------------------------------

let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let failures = 0
const MAX_BACKOFF_S = 30

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(Math.pow(2, failures) * (0.8 + Math.random() * 0.4), MAX_BACKOFF_S) * 1000
  failures++
  setState("reconnecting")
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    if (!navigator.onLine) {
      setState("offline")
      return
    }
    // Network is up — trigger a realtime reconnect attempt.
    // onRealtimeConnect will set "connected" when the channel truly reconnects.
    window.dispatchEvent(new CustomEvent("vortex:realtime-retry"))
  }, delay)
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
}

// --- Public hook -------------------------------------------------------------------

/**
 * Tracks browser online/offline state with a reconnection FSM.
 *
 * States: connected → disconnected → reconnecting → (connected | offline)
 *
 * Listens to:
 *  - navigator.onLine / offline/online events
 *  - Supabase Realtime channel state changes (via custom events)
 */
export function useConnectionStatus(): {
  status: ConnectionState
  retry: () => void
} {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    function onOnline() {
      cancelReconnect()
      // Network is back — request a realtime reconnect.
      // Don't set "connected" here; wait for onRealtimeConnect to confirm.
      setState("reconnecting")
      window.dispatchEvent(new CustomEvent("vortex:realtime-retry"))
    }

    function onOffline() {
      cancelReconnect()
      setState("offline")
    }

    // Listen for Supabase Realtime disconnect events dispatched elsewhere
    function onRealtimeDisconnect() {
      if (!navigator.onLine) {
        setState("offline")
      } else {
        setState("disconnected")
        scheduleReconnect()
      }
    }

    function onRealtimeConnect() {
      cancelReconnect()
      failures = 0
      setState("connected")
    }

    // Seed initial state
    if (!navigator.onLine) setState("offline")

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    window.addEventListener("vortex:realtime-disconnect", onRealtimeDisconnect)
    window.addEventListener("vortex:realtime-connect", onRealtimeConnect)

    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("vortex:realtime-disconnect", onRealtimeDisconnect)
      window.removeEventListener("vortex:realtime-connect", onRealtimeConnect)
      cancelReconnect()
      cancelGrace()
    }
  }, [])

  const retry = useCallback(() => {
    cancelReconnect()
    if (navigator.onLine) {
      // Don't set "connected" — wait for onRealtimeConnect to confirm.
      setState("reconnecting")
      window.dispatchEvent(new CustomEvent("vortex:realtime-retry"))
    } else {
      scheduleReconnect()
    }
  }, [])

  return { status, retry }
}
