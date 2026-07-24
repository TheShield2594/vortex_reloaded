"use client"

/**
 * Gateway Context — shares a single Socket.IO gateway connection across
 * all components that need real-time events.
 *
 * Wrap your app layout with <GatewayProvider> and consume via useGatewayContext().
 */

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react"
import { useGateway, type GatewayEventHandlers, type GatewayStatus } from "./use-gateway"
import type { VortexEvent, UserStatus, GatewayServerEvents } from "@vortex/shared"

/**
 * Channel event listener. `meta.replay` is true when the event is being
 * delivered from a reconnection catch-up batch (gateway:replay) rather than
 * live — consumers use it to suppress side effects like notification sounds
 * for messages that arrived while the client was disconnected (issue #58 §2).
 */
type EventListener = (event: VortexEvent, meta?: { replay?: boolean }) => void
type TypingListener = (data: GatewayServerEvents["gateway:typing"]) => void
type PresenceListener = (data: GatewayServerEvents["gateway:presence"]) => void
type CallSignalListener = (data: GatewayServerEvents["gateway:call-signal"]) => void

interface GatewayContextValue {
  status: GatewayStatus
  subscribe: (channelIds: string[]) => void
  unsubscribe: (channelIds: string[]) => void
  sendTyping: (channelId: string, isTyping: boolean) => void
  sendPresence: (status: UserStatus) => void
  sendCallSignal: (payload: {
    channelId: string
    type: "invite" | "cancel" | "accept" | "decline"
    withVideo?: boolean
    callerName?: string
    callerAvatar?: string | null
  }) => void
  getLastEventId: (channelId: string) => string | undefined
  addEventListener: (channelId: string, listener: EventListener) => () => void
  addTypingListener: (channelId: string, listener: TypingListener) => () => void
  addPresenceListener: (listener: PresenceListener) => () => void
  addCallSignalListener: (channelId: string, listener: CallSignalListener) => () => void
}

const GatewayContext = createContext<GatewayContextValue | null>(null)

export function GatewayProvider({ children }: { children: ReactNode }) {
  const eventListeners = useRef(new Map<string, Set<EventListener>>())
  const typingListeners = useRef(new Map<string, Set<TypingListener>>())
  const presenceListeners = useRef(new Set<PresenceListener>())
  const callSignalListeners = useRef(new Map<string, Set<CallSignalListener>>())

  const handlers: GatewayEventHandlers = {
    onEvent(event) {
      const listeners = eventListeners.current.get(event.channelId)
      if (listeners) {
        for (const fn of listeners) {
          try { fn(event) } catch { /* ignore */ }
        }
      }
    },
    onTyping(data) {
      const listeners = typingListeners.current.get(data.channelId)
      if (listeners) {
        for (const fn of listeners) {
          try { fn(data) } catch { /* ignore */ }
        }
      }
    },
    onPresence(data) {
      for (const fn of presenceListeners.current) {
        try { fn(data) } catch { /* ignore */ }
      }
    },
    onReplay(data) {
      // Deliver caught-up events to the SAME per-channel listeners that handle
      // live events, tagged replay:true so consumers can skip side effects like
      // notification sounds. Previously replay had its own listener registry
      // with zero consumers, so missed messages were silently dropped (§2).
      const listeners = eventListeners.current.get(data.channelId)
      if (!listeners) return
      for (const event of data.events) {
        for (const fn of listeners) {
          try { fn(event, { replay: true }) } catch { /* ignore */ }
        }
      }
    },
    onResumeComplete(data) {
      // When a channel's gap exceeded the replay buffer, catch-up is incomplete
      // — signal consumers to hard-reload that channel's history so nothing is
      // permanently missed (§2).
      if (data.gapTooLarge.length > 0 && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vortex:gateway-gap", { detail: { channels: data.gapTooLarge } }),
        )
      }
    },
    onCallSignal(data) {
      const listeners = callSignalListeners.current.get(data.channelId)
      if (listeners) {
        for (const fn of listeners) {
          try { fn(data) } catch { /* ignore */ }
        }
      }
    },
  }

  const { status, subscribe, unsubscribe, sendTyping, sendPresence, sendCallSignal, getLastEventId } =
    useGateway(handlers)

  const addEventListener = useCallback((channelId: string, listener: EventListener) => {
    if (!eventListeners.current.has(channelId)) {
      eventListeners.current.set(channelId, new Set())
    }
    eventListeners.current.get(channelId)!.add(listener)
    return () => {
      eventListeners.current.get(channelId)?.delete(listener)
      if (eventListeners.current.get(channelId)?.size === 0) {
        eventListeners.current.delete(channelId)
      }
    }
  }, [])

  const addTypingListener = useCallback((channelId: string, listener: TypingListener) => {
    if (!typingListeners.current.has(channelId)) {
      typingListeners.current.set(channelId, new Set())
    }
    typingListeners.current.get(channelId)!.add(listener)
    return () => {
      typingListeners.current.get(channelId)?.delete(listener)
      if (typingListeners.current.get(channelId)?.size === 0) {
        typingListeners.current.delete(channelId)
      }
    }
  }, [])

  const addPresenceListener = useCallback((listener: PresenceListener) => {
    presenceListeners.current.add(listener)
    return () => { presenceListeners.current.delete(listener) }
  }, [])

  const addCallSignalListener = useCallback((channelId: string, listener: CallSignalListener) => {
    if (!callSignalListeners.current.has(channelId)) {
      callSignalListeners.current.set(channelId, new Set())
    }
    callSignalListeners.current.get(channelId)!.add(listener)
    return () => {
      callSignalListeners.current.get(channelId)?.delete(listener)
      if (callSignalListeners.current.get(channelId)?.size === 0) {
        callSignalListeners.current.delete(channelId)
      }
    }
  }, [])

  const value: GatewayContextValue = {
    status,
    subscribe,
    unsubscribe,
    sendTyping,
    sendPresence,
    sendCallSignal,
    getLastEventId,
    addEventListener,
    addTypingListener,
    addPresenceListener,
    addCallSignalListener,
  }

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  )
}

export function useGatewayContext(): GatewayContextValue {
  const ctx = useContext(GatewayContext)
  if (!ctx) {
    throw new Error("useGatewayContext must be used within a GatewayProvider")
  }
  return ctx
}
