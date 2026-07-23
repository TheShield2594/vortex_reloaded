"use client"

import { useEffect, useRef } from "react"
import { useAppStore } from "@/lib/stores/app-store"
import { useGatewayContext } from "./use-gateway-context"
import type { VortexEvent } from "@vortex/shared"

/**
 * Syncs the global notification unread count to Zustand on mount and via
 * the gateway. This ensures the mobile bottom tab bar badge shows the correct
 * count even when NotificationBell is not mounted (e.g. on mobile home screens).
 */
export function useNotificationCountSync(userId: string | null): void {
  const gateway = useGatewayContext()
  const seededRef = useRef(false)

  useEffect(() => {
    if (!userId) return
    seededRef.current = false

    // Fetch initial count — only apply if a gateway event hasn't already updated
    async function fetchCount(): Promise<void> {
      try {
        const res = await fetch("/api/notifications/unread-count")
        if (!res.ok) return
        const data = await res.json() as { count?: number }
        if (typeof data.count === "number") {
          // Only seed if this is the first load or the store hasn't been
          // updated by a gateway event with a higher value
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
  }, [userId])

  // Gateway: bump the count when a new notification is created, and keep it
  // in sync with read/dismiss state changes made from other tabs (see
  // apps/web/app/api/notifications/route.ts's publishGatewayEvent(...) calls).
  useEffect(() => {
    if (!userId) return
    const removeListener = gateway.addEventListener(`user:${userId}`, (event: VortexEvent) => {
      if (event.type === "notification.created") {
        const n = event.data as { read?: boolean } | undefined
        if (n?.read === true) return
        seededRef.current = true
        useAppStore.setState((state) => ({
          notificationUnreadCount: (state.notificationUnreadCount ?? 0) + 1,
        }))
        return
      }

      // notification.updated is only published on an unread → read
      // transition (see the API route), so any occurrence decrements.
      if (event.type === "notification.updated") {
        useAppStore.setState((state) => ({
          notificationUnreadCount: Math.max(0, (state.notificationUnreadCount ?? 0) - 1),
        }))
        return
      }

      if (event.type === "notification.deleted") {
        const old = event.data as { read?: boolean } | undefined
        if (old?.read === false) {
          useAppStore.setState((state) => ({
            notificationUnreadCount: Math.max(0, (state.notificationUnreadCount ?? 0) - 1),
          }))
        }
      }
    })
    return () => removeListener()
  }, [userId, gateway])
}
