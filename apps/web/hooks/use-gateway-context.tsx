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

type EventListener = (event: VortexEvent) => void
type TypingListener = (data: GatewayServerEvents["gateway:typing"]) => void
type PresenceListener = (data: GatewayServerEvents["gateway:presence"]) => void
type ReplayListener = (data: GatewayServerEvents["gateway:replay"]) => void

interface GatewayContextValue {
  status: GatewayStatus
  subscribe: (channelIds: string[]) => void
  unsubscribe: (channelIds: string[]) => void
  sendTyping: (channelId: string, isTyping: boolean) => void
  sendPresence: (status: UserStatus) => void
  getLastEventId: (channelId: string) => string | undefined
  addEventListener: (channelId: string, listener: EventListener) => () => void
  addTypingListener: (channelId: string, listener: TypingListener) => () => void
  addPresenceListener: (listener: PresenceListener) => () => void
  addReplayListener: (channelId: string, listener: ReplayListener) => () => void
}

const GatewayContext = createContext<GatewayContextValue | null>(null)

export function GatewayProvider({ children }: { children: ReactNode }) {
  const eventListeners = useRef(new Map<string, Set<EventListener>>())
  const typingListeners = useRef(new Map<string, Set<TypingListener>>())
  const presenceListeners = useRef(new Set<PresenceListener>())
  const replayListeners = useRef(new Map<string, Set<ReplayListener>>())

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
      const listeners = replayListeners.current.get(data.channelId)
      if (listeners) {
        for (const fn of listeners) {
          try { fn(data) } catch { /* ignore */ }
        }
      }
    },
  }

  const { status, subscribe, unsubscribe, sendTyping, sendPresence, getLastEventId } =
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

  const addReplayListener = useCallback((channelId: string, listener: ReplayListener) => {
    if (!replayListeners.current.has(channelId)) {
      replayListeners.current.set(channelId, new Set())
    }
    replayListeners.current.get(channelId)!.add(listener)
    return () => {
      replayListeners.current.get(channelId)?.delete(listener)
      if (replayListeners.current.get(channelId)?.size === 0) {
        replayListeners.current.delete(channelId)
      }
    }
  }, [])

  const value: GatewayContextValue = {
    status,
    subscribe,
    unsubscribe,
    sendTyping,
    sendPresence,
    getLastEventId,
    addEventListener,
    addTypingListener,
    addPresenceListener,
    addReplayListener,
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
