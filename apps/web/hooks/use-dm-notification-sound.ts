"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { isSoundEnabled } from "@/hooks/use-notification-preferences"
import { shouldNotify, showBrowserNotification } from "@/lib/notification-manager"

/**
 * Global DM notification sound hook — mounted in AppProvider so it fires
 * even when the DMList component is not rendered (e.g. user is on a server).
 *
 * Listens for direct_messages INSERTs for the current user's DM channels
 * and plays a notification sound + shows browser notification when appropriate.
 */
export function useDmNotificationSound(userId: string | null): void {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const { playNotification } = useNotificationSound()
  const playRef = useRef(playNotification)
  playRef.current = playNotification
  const subIdRef = useRef(0)

  useEffect(() => {
    if (!userId) return

    // Subscribe to all direct_messages sent TO this user (sender_id != userId)
    // We filter by the table and check sender_id in the callback since
    // Supabase realtime doesn't support != filters.
    const subId = ++subIdRef.current
    const ch = supabase
      .channel(`dm-notif-sound:${userId}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
        },
        (payload) => {
          const raw = payload.new
          if (!raw || typeof raw !== "object") return

          const msg = raw as Record<string, unknown>
          const senderId = typeof msg.sender_id === "string" ? msg.sender_id : undefined
          const msgId = typeof msg.id === "string" ? msg.id : undefined
          const dmChannelId = typeof msg.dm_channel_id === "string" ? msg.dm_channel_id : undefined
          const content = typeof msg.content === "string" ? msg.content : undefined

          if (!senderId || senderId === userId) return

          const { shouldPlaySound, shouldShowBrowserNotification } = shouldNotify({
            dmChannelId,
            messageId: msgId,
          })

          if (shouldPlaySound && isSoundEnabled()) {
            playRef.current("dm")
          }

          if (shouldShowBrowserNotification) {
            showBrowserNotification({
              title: "New Message",
              body: content?.slice(0, 100) || "Sent a message",
              channelId: dmChannelId,
              url: dmChannelId ? `/channels/me/${dmChannelId}` : "/channels/me",
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [userId, supabase])
}
