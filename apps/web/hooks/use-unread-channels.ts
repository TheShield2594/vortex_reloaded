"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"

function isMessagePayload(
  obj: unknown
): obj is { channel_id: string; author_id: string; mentions?: string[] } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "channel_id" in obj &&
    typeof (obj as Record<string, unknown>).channel_id === "string" &&
    "author_id" in obj &&
    typeof (obj as Record<string, unknown>).author_id === "string"
  )
}

/**
 * Tracks which channels have unread messages for the current user (display only).
 *
 * Strategy:
 *   1. On mount: load read_states from DB and compare against latest messages.
 *   2. Subscribe to message INSERTs — mark channels unread when new messages
 *      arrive in non-active channels.
 *   3. When activeChannelId changes: clear local unread state for that channel.
 *      The actual DB write (mark_channel_read RPC) is handled by
 *      useMarkChannelRead in ChatArea, keeping read-state ownership in the
 *      component that's mounted while the user is reading.
 */
export function useUnreadChannels(
  serverId: string,
  channelIds: string[],
  currentUserId: string,
  activeChannelId: string | null,
  onNewUnread?: () => void,
  initialData?: { unreadChannelIds: string[]; mentionCounts: Record<string, number> }
): { unreadChannelIds: Set<string>; mentionCounts: Record<string, number> } {
  const onNewUnreadRef = useRef(onNewUnread)
  onNewUnreadRef.current = onNewUnread
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const [unreadChannelIds, setUnreadChannelIds] = useState<Set<string>>(
    () => new Set(initialData?.unreadChannelIds ?? [])
  )
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>(
    initialData?.mentionCounts ?? {}
  )
  const activeChannelRef = useRef(activeChannelId)
  activeChannelRef.current = activeChannelId

  // Clear local unread state when the user enters a channel.
  // No RPC here — ChatArea's useMarkChannelRead handles the DB write.
  const clearUnread = useCallback((channelId: string) => {
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev
      const next = new Set(prev)
      next.delete(channelId)
      return next
    })
    setMentionCounts((prev) => {
      if (!prev[channelId]) return prev
      const next = { ...prev }
      delete next[channelId]
      return next
    })
  }, [])

  // When activeChannelId changes, immediately clear the unread indicator
  useEffect(() => {
    if (activeChannelId) {
      clearUnread(activeChannelId)
    }
  }, [activeChannelId, clearUnread])

  // Load initial unread state from DB.
  // Always runs (even when initialData is provided) so that remounts on
  // mobile get fresh data instead of stale server-rendered props.
  useEffect(() => {
    if (channelIds.length === 0) return

    async function loadInitialUnread(): Promise<void> {
      try {
        const { data: readStates, error: rsError } = await supabase
          .from("read_states")
          .select("channel_id, last_read_at, mention_count")
          .eq("user_id", currentUserId)
          .in("channel_id", channelIds)

        if (rsError) {
          console.error("useUnreadChannels: failed to load read_states", rsError.message)
          return
        }

        const readMap: Record<string, string> = {}
        const mentionMap: Record<string, number> = {}
        for (const rs of readStates ?? []) {
          readMap[rs.channel_id] = rs.last_read_at
          if (rs.mention_count > 0) mentionMap[rs.channel_id] = rs.mention_count
        }

        const unread = new Set<string>()
        const channelsWithReadState = Object.keys(readMap)

        if (channelsWithReadState.length > 0) {
          const { data: latestMessages, error: msgError } = await supabase
            .from("messages")
            .select("channel_id, created_at")
            .in("channel_id", channelsWithReadState)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(Math.max(channelsWithReadState.length * 10, 100))

          if (msgError) {
            console.error("useUnreadChannels: failed to load latest messages", msgError.message)
            return
          }

          const latestPerChannel: Record<string, string> = {}
          for (const msg of latestMessages ?? []) {
            if (!latestPerChannel[msg.channel_id]) {
              latestPerChannel[msg.channel_id] = msg.created_at
            }
          }

          for (const channelId of channelsWithReadState) {
            const latest = latestPerChannel[channelId]
            const lastRead = readMap[channelId]
            if (latest && latest > lastRead && channelId !== activeChannelRef.current) {
              unread.add(channelId)
            }
          }
        }

        setUnreadChannelIds(unread)
        setMentionCounts(mentionMap)
      } catch (err) {
        console.error("useUnreadChannels: loadInitialUnread failed", err)
      }
    }

    loadInitialUnread()
  }, [serverId, currentUserId])

  // Subscribe to new messages across this server's channels
  const unreadSubIdRef = useRef(0)
  useEffect(() => {
    if (channelIds.length === 0) return

    const subId = ++unreadSubIdRef.current

    const channel = supabase
      .channel(`server-messages:${serverId}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=in.(${channelIds.join(",")})`,
        },
        (payload) => {
          if (!isMessagePayload(payload.new)) return
          const msg = payload.new

          // Don't mark as unread if it's own message or if channel is active
          if (msg.author_id === currentUserId) return
          if (msg.channel_id === activeChannelRef.current) return

          setUnreadChannelIds((prev) => {
            if (prev.has(msg.channel_id)) return prev
            const next = new Set(prev)
            next.add(msg.channel_id)
            // Only fire notification on read→unread transition
            onNewUnreadRef.current?.()
            return next
          })

          // Update mention counts from realtime messages
          const mentions = Array.isArray(msg.mentions) ? msg.mentions : []
          if (mentions.includes(currentUserId)) {
            setMentionCounts((prev) => ({
              ...prev,
              [msg.channel_id]: (prev[msg.channel_id] ?? 0) + 1,
            }))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [serverId, [...channelIds].sort().join(","), currentUserId])

  return { unreadChannelIds, mentionCounts }
}
