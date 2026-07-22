"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

/**
 * Shared Supabase Realtime postgres_changes subscription hook.
 *
 * Extracts the common pattern of:
 *   1. Creating a client Supabase instance (memoised)
 *   2. Setting up a channel with postgres_changes handlers
 *   3. Subscribing and dispatching vortex:realtime-connect/disconnect events
 *   4. Cleaning up on unmount or dependency change
 *
 * Previously duplicated across:
 *   - use-realtime-messages.ts
 *   - use-realtime-threads.ts
 *   - use-unread-channels.ts
 */

type PostgresEvent = "INSERT" | "UPDATE" | "DELETE" | "*"

export interface PostgresChangeHandler {
  event: PostgresEvent
  schema?: string
  table: string
  filter?: string
  callback: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
}

interface UseSupabaseSubscriptionOptions {
  /** Unique channel name (e.g. `messages:${channelId}`) */
  channelName: string
  /** Array of postgres_changes handlers to register. */
  handlers: PostgresChangeHandler[]
  /** When true, dispatches vortex:realtime-connect/disconnect custom events. */
  dispatchConnectionEvents?: boolean
  /** Called on reconnection (status transitions back to SUBSCRIBED). */
  onReconnect?: () => void
  /** Called on status changes. */
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void
}

/**
 * Returns the memoised Supabase client for use in callbacks that need it
 * (e.g. fetching hydrated data on INSERT).
 */
export function useSupabaseSubscription(
  options: UseSupabaseSubscriptionOptions,
  deps: unknown[] = []
) {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const wasConnectedRef = useRef(false)
  const subIdRef = useRef(0)

  // Store latest callbacks in refs to avoid stale closures
  const handlersRef = useRef(options.handlers)
  handlersRef.current = options.handlers
  const onReconnectRef = useRef(options.onReconnect)
  onReconnectRef.current = options.onReconnect
  const onStatusChangeRef = useRef(options.onStatusChange)
  onStatusChangeRef.current = options.onStatusChange

  useEffect(() => {
    wasConnectedRef.current = false
    let isCleaningUp = false
    const subId = ++subIdRef.current

    let builder = supabase.channel(`${options.channelName}:${subId}`)

    for (const handler of handlersRef.current) {
      builder = builder.on(
        "postgres_changes",
        {
          event: handler.event,
          schema: handler.schema ?? "public",
          table: handler.table,
          ...(handler.filter ? { filter: handler.filter } : {}),
        },
        (payload) => {
          // Find the matching handler from the current ref to avoid stale closure
          handler.callback(payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
        }
      )
    }

    const channel = builder.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (wasConnectedRef.current) {
          onReconnectRef.current?.()
        }
        wasConnectedRef.current = true
        onStatusChangeRef.current?.("connected")
        if (options.dispatchConnectionEvents) {
          window.dispatchEvent(new CustomEvent("vortex:realtime-connect"))
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onStatusChangeRef.current?.("disconnected")
        if (options.dispatchConnectionEvents) {
          window.dispatchEvent(new CustomEvent("vortex:realtime-disconnect"))
        }
      } else if (status === "CLOSED") {
        if (!isCleaningUp) {
          onStatusChangeRef.current?.("disconnected")
          if (options.dispatchConnectionEvents) {
            window.dispatchEvent(new CustomEvent("vortex:realtime-disconnect"))
          }
        }
      }
    })

    // Listen for reconnect requests from connection-status FSM
    function onRealtimeRetry() {
      supabase.removeChannel(channel)
      channel.subscribe()
    }

    if (options.dispatchConnectionEvents) {
      window.addEventListener("vortex:realtime-retry", onRealtimeRetry)
    }

    return () => {
      isCleaningUp = true
      if (options.dispatchConnectionEvents) {
        window.removeEventListener("vortex:realtime-retry", onRealtimeRetry)
      }
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.channelName, ...deps])

  return supabase
}
