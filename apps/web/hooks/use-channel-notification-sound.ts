"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { isSoundEnabled } from "@/hooks/use-notification-preferences"
import { shouldNotify, showBrowserNotification } from "@/lib/notification-manager"
import { useAppStore } from "@/lib/stores/app-store"

/**
 * Global channel message notification hook — mounted in AppProvider so it fires
 * even when the ChatArea component is not rendered.
 *
 * Listens for messages INSERTs and shows browser notification + plays sound
 * when the user's per-server/channel notification mode is "all".
 * Mentions/replies are handled separately by notification-bell via the
 * notifications table, so this only fires for regular messages.
 */
export function useChannelNotificationSound(userId: string | null): void {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const { playNotification } = useNotificationSound()
  const playRef = useRef(playNotification)
  playRef.current = playNotification
  const subIdRef = useRef(0)

  useEffect(() => {
    if (!userId) return

    const subId = ++subIdRef.current
    const ch = supabase
      .channel(`channel-notif-sound:${userId}:${subId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          try {
          const raw = payload.new
          if (!raw || typeof raw !== "object") return

          const msg = raw as Record<string, unknown>
          const authorId = typeof msg.author_id === "string" ? msg.author_id : undefined
          const msgId = typeof msg.id === "string" ? msg.id : undefined
          const channelId = typeof msg.channel_id === "string" ? msg.channel_id : undefined
          const content = typeof msg.content === "string" ? msg.content : undefined

          // Don't notify on own messages
          if (!authorId || authorId === userId) return

          // Check per-server notification mode from Zustand store
          const state = useAppStore.getState()

          // Don't default to "all" until notification modes have been hydrated —
          // an empty map means loadNotificationSettings hasn't resolved yet.
          const modesHydrated = state.notificationModesLoaded === true

          // Find which server this channel belongs to
          let serverId: string | null = null
          for (const [sid, channels] of Object.entries(state.channels)) {
            if (channels.some((c) => c.id === channelId)) {
              serverId = sid
              break
            }
          }

          if (!serverId) return

          // Check notification mode — only notify for "all" mode
          // (mentions are handled via the notifications table separately)
          const channelMode = channelId ? state.notificationModes[channelId] : undefined
          const serverMode = state.notificationModes[serverId]
          const mode = channelMode ?? serverMode ?? (modesHydrated ? "all" : undefined)

          // If modes aren't hydrated yet, skip to avoid false positives
          if (!mode) return
          if (mode === "muted" || mode === "mentions") return

          const { shouldPlaySound, shouldShowBrowserNotification } = shouldNotify({
            channelId,
            messageId: msgId,
          })

          if (shouldPlaySound && isSoundEnabled()) {
            playRef.current("message")
          }

          if (shouldShowBrowserNotification) {
            // Respect user's show_message_preview preference from localStorage
            let showPreview = true
            try {
              const stored = localStorage.getItem(`vortexchat:notif-prefs:${userId}`)
              if (stored) {
                const parsed = JSON.parse(stored) as Record<string, unknown>
                if (parsed.show_message_preview === false) showPreview = false
              }
            } catch { /* ignore */ }

            showBrowserNotification({
              title: "New Message",
              body: showPreview ? (content?.slice(0, 100) || "Sent a message") : "Sent a message",
              channelId,
              url: serverId && channelId ? `/channels/${serverId}/${channelId}` : undefined,
            })
          }
          } catch (err) {
            console.error("[useChannelNotificationSound] handler error:", err)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [userId, supabase])
}
