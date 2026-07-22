"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { ThreadRow, MessageWithAuthor, MessageRow, ReactionRow } from "@/types/database"

/**
 * Subscribes to realtime events for:
 * - Thread inserts/updates in a parent channel
 * - Message inserts/updates inside a specific thread
 */
export function useRealtimeThreads(
  channelId: string,
  onThreadInsert: (thread: ThreadRow) => void,
  onThreadUpdate: (thread: ThreadRow) => void
) {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const onInsertRef = useRef(onThreadInsert)
  const onUpdateRef = useRef(onThreadUpdate)
  onInsertRef.current = onThreadInsert
  onUpdateRef.current = onThreadUpdate
  const threadSubIdRef = useRef(0)

  useEffect(() => {
    const subId = ++threadSubIdRef.current
    const subscription = supabase
      .channel(`threads:channel:${channelId}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "threads",
          filter: `parent_channel_id=eq.${channelId}`,
        },
        (payload) => {
          onInsertRef.current(payload.new as ThreadRow)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "threads",
          filter: `parent_channel_id=eq.${channelId}`,
        },
        (payload) => {
          onUpdateRef.current(payload.new as ThreadRow)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [channelId])
}

/**
 * Subscribes to realtime message events inside a single thread.
 */
export function useRealtimeThreadMessages(
  threadId: string,
  onInsert: (message: MessageWithAuthor) => void,
  onUpdate: (message: MessageRow) => void,
  onReactionInsert?: (reaction: ReactionRow) => void,
  onReactionDelete?: (reaction: ReactionRow) => void
) {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const onInsertRef = useRef(onInsert)
  const onUpdateRef = useRef(onUpdate)
  const onReactionInsertRef = useRef(onReactionInsert)
  const onReactionDeleteRef = useRef(onReactionDelete)
  onInsertRef.current = onInsert
  onUpdateRef.current = onUpdate
  onReactionInsertRef.current = onReactionInsert
  onReactionDeleteRef.current = onReactionDelete
  const threadMsgSubIdRef = useRef(0)

  useEffect(() => {
    const subId = ++threadMsgSubIdRef.current
    const subscription = supabase
      .channel(`thread_messages:${threadId}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from("messages")
            .select(`*, author:users!messages_author_id_fkey(*), attachments(*), reactions(*)`)
            .eq("id", payload.new.id)
            .single()
          if (data) onInsertRef.current(data as unknown as MessageWithAuthor)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          onUpdateRef.current(payload.new as MessageRow)
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions" },
        (payload) => {
          onReactionInsertRef.current?.(payload.new as ReactionRow)
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reactions" },
        (payload) => {
          onReactionDeleteRef.current?.(payload.old as ReactionRow)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [threadId])
}
