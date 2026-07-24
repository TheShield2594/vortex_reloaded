"use client"

/**
 * Unified Socket.IO Gateway Hook
 *
 * Provides a single Socket.IO connection to the signal server for all
 * real-time events: messages, reactions, typing, presence, and reconnection
 * catch-up. Replaces multiple Supabase Realtime subscriptions with a single
 * WebSocket transport.
 *
 * Usage:
 *   const { subscribe, unsubscribe, sendTyping, sendPresence, resume, status, lastEventIds } = useGateway()
 *
 * #592: Unified Socket.IO Real-Time Gateway
 * #595: WebSocket-Based Presence & Typing
 * #597: Reconnection Catch-Up Protocol
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import type {
  VortexEvent,
  UserStatus,
  GatewayServerEvents,
} from "@vortex/shared"

export type GatewayStatus = "connecting" | "connected" | "disconnected" | "reconnecting"

export interface GatewayEventHandlers {
  onEvent?: (event: VortexEvent) => void
  onTyping?: (data: GatewayServerEvents["gateway:typing"]) => void
  onPresence?: (data: GatewayServerEvents["gateway:presence"]) => void
  onReplay?: (data: GatewayServerEvents["gateway:replay"]) => void
  onResumeComplete?: (data: GatewayServerEvents["gateway:resume-complete"]) => void
  onCallSignal?: (data: GatewayServerEvents["gateway:call-signal"]) => void
  onSubscribed?: (data: GatewayServerEvents["gateway:subscribed"]) => void
}

interface GatewayState {
  socket: Socket | null
  status: GatewayStatus
  subscribedChannels: Set<string>
  lastEventIds: Map<string, string>
}

const SIGNAL_SERVER_URL = process.env.NEXT_PUBLIC_SIGNAL_URL ?? "http://localhost:3001"

/**
 * Better Auth's `jwt` plugin issues short-lived tokens (15 min, see
 * lib/auth/better-auth.ts) for apps/signal to verify locally against its
 * JWKS — a deliberately shorter lifetime than Supabase's old ~1hr session
 * JWT (see docs/better-auth-verification-spike.md §3). Fetched fresh on
 * every (re)connection attempt via socket.io's function-form `auth` option
 * below, rather than once at mount, so a long-lived tab reconnecting hours
 * later doesn't hand the gateway an already-expired token.
 */
async function fetchGatewayToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token", { credentials: "include" })
    if (!res.ok) return null
    const data = (await res.json()) as { token?: string }
    return data.token ?? null
  } catch {
    return null
  }
}

/**
 * The initial fetch (unlike the per-reconnect one passed to socket.io's
 * function-form `auth` option) has no built-in retry mechanism of its own —
 * if it fails once (a transient blip, or racing the session cookie not
 * being fully committed yet right after login), `io()` is never called and
 * there's no socket for socket.io's own reconnection logic to act on.
 * Bounded exponential backoff here covers that gap without retrying forever.
 */
async function fetchGatewayTokenWithRetry(
  isDestroyed: () => boolean,
  maxAttempts = 5,
): Promise<string | null> {
  let delay = 500
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isDestroyed()) return null
    const token = await fetchGatewayToken()
    if (token) return token
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 5000)
    }
  }
  return null
}

export function useGateway(handlers?: GatewayEventHandlers) {
  const [status, setStatus] = useState<GatewayStatus>("disconnected")
  const socketRef = useRef<Socket | null>(null)
  const stateRef = useRef<GatewayState>({
    socket: null,
    status: "disconnected",
    subscribedChannels: new Set(),
    lastEventIds: new Map(),
  })
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let destroyed = false

    async function connect(): Promise<void> {
      try {
        const initialToken = await fetchGatewayTokenWithRetry(() => destroyed)
        if (!initialToken || destroyed) {
          if (!initialToken && !destroyed) {
            console.error("[gateway] failed to fetch initial token after retries")
          }
          return
        }

        const socket = io(SIGNAL_SERVER_URL, {
          // Function form: re-invoked on every (re)connection attempt so a
          // near-expiry or already-expired JWT gets refreshed automatically
          // instead of socket.io reusing whatever token was captured at the
          // first `io()` call.
          auth: async (cb) => cb({ token: (await fetchGatewayToken()) ?? initialToken }),
          transports: ["websocket"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          timeout: 20000,
        })

        socketRef.current = socket
        stateRef.current.socket = socket

        socket.on("connect", () => {
          if (destroyed) return
          setStatus("connected")
          stateRef.current.status = "connected"

          // Initialize gateway (sets up presence)
          socket.emit("gateway:init", { status: "online" as UserStatus })

          // Re-subscribe to previously subscribed channels
          const channels = Array.from(stateRef.current.subscribedChannels)
          if (channels.length > 0) {
            socket.emit("gateway:subscribe", { channelIds: channels })
          }

          // If we have lastEventIds, attempt to resume
          if (stateRef.current.lastEventIds.size > 0) {
            const channelMap: Record<string, string> = {}
            for (const [chId, evId] of stateRef.current.lastEventIds) {
              channelMap[chId] = evId
            }
            socket.emit("gateway:resume", { channels: channelMap })
          }

          // Notify connection-status FSM
          window.dispatchEvent(new CustomEvent("vortex:realtime-connect"))

          // Drain offline message queue on reconnect (#656)
          // Dispatch flush-outbox so chat-outbox hooks resend pending/failed messages
          window.dispatchEvent(new CustomEvent("vortex:flush-outbox"))
        })

        socket.on("disconnect", () => {
          if (destroyed) return
          clearTypingTimers()
          setStatus("disconnected")
          stateRef.current.status = "disconnected"
          window.dispatchEvent(new CustomEvent("vortex:realtime-disconnect"))

          // Reset in-flight outbox messages to pending so they retry on reconnect (#656)
          window.dispatchEvent(new CustomEvent("vortex:outbox-reset-sending"))
        })

        socket.io.on("reconnect_attempt", () => {
          if (destroyed) return
          setStatus("reconnecting")
          stateRef.current.status = "reconnecting"
        })

        // ── Event handlers ────────────────────────────────────────────────
        socket.on("gateway:event", (event: VortexEvent) => {
          // Track last event ID per channel for reconnection catch-up
          stateRef.current.lastEventIds.set(event.channelId, event.id)
          handlersRef.current?.onEvent?.(event)
        })

        socket.on("gateway:typing", (data: GatewayServerEvents["gateway:typing"]) => {
          handlersRef.current?.onTyping?.(data)
        })

        socket.on("gateway:presence", (data: GatewayServerEvents["gateway:presence"]) => {
          handlersRef.current?.onPresence?.(data)
        })

        socket.on("gateway:replay", (data: GatewayServerEvents["gateway:replay"]) => {
          // Advance the per-channel cursor across the replayed batch so a
          // later resume asks only for what's newer, not the same gap again.
          // Events arrive in order, so the last one is the newest.
          for (const event of data.events) {
            stateRef.current.lastEventIds.set(event.channelId, event.id)
          }
          handlersRef.current?.onReplay?.(data)
        })

        socket.on("gateway:resume-complete", (data: GatewayServerEvents["gateway:resume-complete"]) => {
          handlersRef.current?.onResumeComplete?.(data)
        })

        socket.on("gateway:call-signal", (data: GatewayServerEvents["gateway:call-signal"]) => {
          handlersRef.current?.onCallSignal?.(data)
        })

        socket.on("gateway:subscribed", (data: GatewayServerEvents["gateway:subscribed"]) => {
          // Reconcile optimistic state with what the server actually
          // authorized: subscribe() adds channels to subscribedChannels before
          // the server confirms, so drop any the membership check refused
          // (issue #51) instead of believing we're subscribed to a room we'll
          // never receive events for — and so we don't re-request it on every
          // reconnect.
          const denied = data.denied ?? []
          for (const id of denied) {
            stateRef.current.subscribedChannels.delete(id)
            stateRef.current.lastEventIds.delete(id)
          }
          handlersRef.current?.onSubscribed?.(data)
        })

        socket.on("error", (err: { message: string }) => {
          console.error("[gateway] server error:", err.message)
        })
      } catch (err) {
        console.error("[gateway] connection error:", err)
      }
    }

    connect()

    return () => {
      destroyed = true
      clearTypingTimers()
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
        stateRef.current.socket = null
      }
    }
  }, [])

  // ── Public API ──────────────────────────────────────────────────────────

  const subscribe = useCallback((channelIds: string[]) => {
    const socket = socketRef.current
    if (!socket?.connected) {
      // Queue for when we reconnect
      for (const id of channelIds) {
        stateRef.current.subscribedChannels.add(id)
      }
      return
    }

    const newChannels = channelIds.filter((id) => !stateRef.current.subscribedChannels.has(id))
    if (newChannels.length === 0) return

    for (const id of newChannels) {
      stateRef.current.subscribedChannels.add(id)
    }
    socket.emit("gateway:subscribe", { channelIds: newChannels })
  }, [])

  const unsubscribe = useCallback((channelIds: string[]) => {
    for (const id of channelIds) {
      stateRef.current.subscribedChannels.delete(id)
      stateRef.current.lastEventIds.delete(id)
    }
    socketRef.current?.emit("gateway:unsubscribe", { channelIds })
  }, [])

  // Debounced typing indicator: emit isTyping:true immediately on first
  // keystroke, suppress further true emissions for 2s, and auto-emit
  // isTyping:false after 3s of inactivity. (~80% reduction in typing traffic)
  const typingTimersRef = useRef<Map<string, { suppressUntil: number; stopTimer: ReturnType<typeof setTimeout> | null }>>(new Map())

  /** Clear all pending typing timers (used on disconnect and unmount). */
  const clearTypingTimers = useCallback((): void => {
    for (const [, entry] of typingTimersRef.current) {
      if (entry.stopTimer) clearTimeout(entry.stopTimer)
    }
    typingTimersRef.current.clear()
  }, [])

  const sendTyping = useCallback((channelId: string, isTyping: boolean, displayName?: string) => {
    const socket = socketRef.current
    if (!socket?.connected) return

    const timers = typingTimersRef.current
    const existing = timers.get(channelId)

    if (!isTyping) {
      // Explicit stop — clear timers and send immediately. displayName is
      // omitted: stop events are matched by userId on the receiving side.
      if (existing?.stopTimer) clearTimeout(existing.stopTimer)
      timers.delete(channelId)
      socket.volatile.emit("gateway:typing", { channelId, isTyping: false })
      return
    }

    const now = Date.now()

    // If we're within the suppress window, just reset the inactivity timer
    if (existing && now < existing.suppressUntil) {
      if (existing.stopTimer) clearTimeout(existing.stopTimer)
      existing.stopTimer = setTimeout(() => {
        timers.delete(channelId)
        if (socketRef.current?.connected) {
          socketRef.current.volatile.emit("gateway:typing", { channelId, isTyping: false })
        }
      }, 3000)
      return
    }

    // First keystroke (or suppress window expired) — emit immediately, carrying
    // the sender's display name so the server can relay it (issue #58 §3).
    if (existing?.stopTimer) clearTimeout(existing.stopTimer)
    socket.volatile.emit("gateway:typing", { channelId, isTyping: true, displayName })
    timers.set(channelId, {
      suppressUntil: now + 2000,
      stopTimer: setTimeout(() => {
        timers.delete(channelId)
        if (socketRef.current?.connected) {
          socketRef.current.volatile.emit("gateway:typing", { channelId, isTyping: false })
        }
      }, 3000),
    })
  }, [])

  const sendPresence = useCallback((newStatus: UserStatus) => {
    socketRef.current?.emit("gateway:presence", { status: newStatus })
  }, [])

  const sendCallSignal = useCallback(
    (payload: {
      channelId: string
      type: "invite" | "cancel" | "accept" | "decline"
      withVideo?: boolean
      callerName?: string
      callerAvatar?: string | null
    }) => {
      socketRef.current?.emit("gateway:call-signal", payload)
    },
    [],
  )

  const getLastEventId = useCallback((channelId: string): string | undefined => {
    return stateRef.current.lastEventIds.get(channelId)
  }, [])

  return {
    status,
    subscribe,
    unsubscribe,
    sendTyping,
    sendPresence,
    sendCallSignal,
    getLastEventId,
  }
}
