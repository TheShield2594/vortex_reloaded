"use client"

import { useEffect, useMemo, useRef, type RefObject } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { MessageWithAuthor, MessageRow, ReactionRow } from "@/types/database"

export type RealtimeStatus = "connecting" | "connected" | "disconnected"

/** Subscribes to real-time message inserts, updates, and reaction changes for a channel via Supabase Realtime postgres_changes.
 *  Detects reconnections and invokes onReconnect so the caller can backfill missed messages. */
export function useRealtimeMessages(
  channelId: string,
  onInsert: (message: MessageWithAuthor) => void,
  onUpdate: (message: MessageRow) => void,
  onReactionInsert?: (reaction: ReactionRow) => void,
  onReactionDelete?: (reaction: ReactionRow) => void,
  onStatusChange?: (status: RealtimeStatus) => void,
  onReconnect?: () => void,
  messagesRef?: React.RefObject<MessageWithAuthor[]>,
) {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const subIdRef = useRef(0)

  useEffect(() => {
    // Effect-local flags — avoids race conditions from shared refs when
    // channelId changes rapidly (each effect instance has its own copy).
    let isCleaningUp = false
    let wasConnected = false
    const subId = ++subIdRef.current

    const channel = supabase
      .channel(`messages:${channelId}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          // Fetch full message with relations (reply_to hydrated separately to
          // avoid depending on the self-referential FK being in PostgREST cache)
          const rawReplyToId = (payload.new as Record<string, unknown>).reply_to_id
          const replyToId = typeof rawReplyToId === "string" ? rawReplyToId : null
          const [messageResult, replyResult] = await Promise.all([
            supabase
              .from("messages")
              .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
              .eq("id", payload.new.id)
              .single(),
            replyToId
              ? supabase
                  .from("messages")
                  .select(`*, author:users!messages_author_id_fkey(*)`)
                  .eq("id", replyToId)
                  .single()
              : Promise.resolve({ data: null }),
          ])
          const data = messageResult.data
          if (!data) return
          const replyTo = replyResult.data ?? null
          onInsert({ ...data, reply_to: replyTo } as unknown as MessageWithAuthor)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          onUpdate(payload.new as MessageRow)
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions" },
        (payload) => {
          if (!onReactionInsert) return
          const reaction = payload.new as ReactionRow
          // Skip reactions for messages not loaded in this channel
          if (messagesRef?.current && !messagesRef.current.some((m) => m.id === reaction.message_id)) return
          onReactionInsert(reaction)
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reactions" },
        (payload) => {
          if (!onReactionDelete) return
          const reaction = payload.old as ReactionRow
          // Skip reactions for messages not loaded in this channel
          if (messagesRef?.current && !messagesRef.current.some((m) => m.id === reaction.message_id)) return
          onReactionDelete(reaction)
        }
      )
      .subscribe((status) => {
        if (isCleaningUp) return
        if (status === "SUBSCRIBED") {
          if (wasConnected) {
            // This is a reconnection — backfill any missed messages
            onReconnect?.()
          }
          wasConnected = true
          onStatusChange?.("connected")
          // Notify the connection-status FSM that realtime is healthy
          window.dispatchEvent(new CustomEvent("vortex:realtime-connect"))
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          onStatusChange?.("disconnected")
          // Notify the connection-status FSM that realtime dropped
          window.dispatchEvent(new CustomEvent("vortex:realtime-disconnect"))
        } else if (status === "CLOSED") {
          // Only treat CLOSED as a disconnect if it wasn't an intentional
          // cleanup (e.g. channel switch calling supabase.removeChannel)
          if (!isCleaningUp) {
            onStatusChange?.("disconnected")
            window.dispatchEvent(new CustomEvent("vortex:realtime-disconnect"))
          }
        }
      })

    // Listen for reconnect requests from the connection-status FSM.
    // When use-connection-status dispatches vortex:realtime-retry (e.g. after
    // coming back online), re-subscribe the Supabase channel.
    function onRealtimeRetry() {
      supabase.removeChannel(channel)
      channel.subscribe()
    }
    window.addEventListener("vortex:realtime-retry", onRealtimeRetry)

    return () => {
      isCleaningUp = true
      window.removeEventListener("vortex:realtime-retry", onRealtimeRetry)
      supabase.removeChannel(channel)
    }
  }, [channelId])
}
