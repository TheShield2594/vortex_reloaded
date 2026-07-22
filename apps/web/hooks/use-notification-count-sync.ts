"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"

/**
 * Syncs the global notification unread count to Zustand on mount and via
 * realtime. This ensures the mobile bottom tab bar badge shows the correct
 * count even when NotificationBell is not mounted (e.g. on mobile home screens).
 */
export function useNotificationCountSync(userId: string | null): void {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const seededRef = useRef(false)
  const subIdRef = useRef(0)

  useEffect(() => {
    if (!userId) return
    seededRef.current = false

    // Fetch initial count — only apply if realtime hasn't already updated
    async function fetchCount(): Promise<void> {
      try {
        const res = await fetch("/api/notifications/unread-count")
        if (!res.ok) return
        const data = await res.json() as { count?: number }
        if (typeof data.count === "number") {
          const current = useAppStore.getState().notificationUnreadCount
          // Only seed if this is the first load or the store hasn't been
          // updated by a realtime event with a higher value
          if (!seededRef.current) {
            useAppStore.setState({ notificationUnreadCount: data.count })
            seededRef.current = true
          }
        }
      } catch {
        // silently ignore — NotificationBell will also sync when mounted
      }
    }
    void fetchCount()

    // Realtime subscription to keep count in sync
    const subId = ++subIdRef.current
    const ch = supabase
      .channel(`notif-count-sync:${userId}:${subId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as { read?: boolean }
          if (newRow.read === true) return
          seededRef.current = true
          useAppStore.setState((state) => ({
            notificationUnreadCount: (state.notificationUnreadCount ?? 0) + 1,
          }))
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const oldRow = payload.old as { read?: boolean }
          const newRow = payload.new as { read?: boolean }
          // Decrement when a notification transitions from unread to read
          if (oldRow.read === false && newRow.read === true) {
            useAppStore.setState((state) => ({
              notificationUnreadCount: Math.max(0, (state.notificationUnreadCount ?? 0) - 1),
            }))
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const old = payload.old as { read?: boolean }
          if (old.read === false) {
            useAppStore.setState((state) => ({
              notificationUnreadCount: Math.max(0, (state.notificationUnreadCount ?? 0) - 1),
            }))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [userId, supabase])
}
