"use client"

import { useEffect } from "react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { useFaviconBadge, UNREAD_INDICATOR } from "@/hooks/use-favicon-badge"

const BASE_TITLE = "VortexChat — Chat, Hang Out, Belong"

/** Post the unread count to the service worker so it can call navigator.setAppBadge(). */
function updateAppBadge(count: number): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({ type: "APP_UPDATE_BADGE", count })
    })
    .catch(() => {})
}

/**
 * Manages the browser tab title, favicon badge, and PWA app badge based on
 * combined notification + DM unread state.
 *
 * Favicon badge logic (matches Fluxer's AppBadge):
 *   - mentionCount > 0 → numeric badge showing the count
 *   - hasUnread but no mentions → dot indicator (•)
 *   - nothing → clear badge, restore original favicon
 *
 * Title format:
 *   - mentions: "(5) VortexChat"
 *   - unread only: "• VortexChat"
 *   - nothing: "VortexChat — Chat, Hang Out, Belong"
 */
export function useTabUnreadTitle(userId: string | null): void {
  const { notificationUnreadCount, notificationMentionCount, dmUnreadCount } = useAppStore(
    useShallow((s) => ({
      notificationUnreadCount: s.notificationUnreadCount,
      notificationMentionCount: s.notificationMentionCount,
      dmUnreadCount: s.dmUnreadCount,
    }))
  )

  const totalUnread = userId ? notificationUnreadCount + dmUnreadCount : 0
  const mentionCount = userId ? notificationMentionCount : 0

  // Compute favicon badge value: numeric for mentions, dot for unread-only, 0 to clear
  let faviconBadge: number
  if (mentionCount > 0) {
    faviconBadge = mentionCount
  } else if (totalUnread > 0) {
    faviconBadge = UNREAD_INDICATOR // dot
  } else {
    faviconBadge = 0 // clear
  }

  // Update browser tab favicon with badge
  useFaviconBadge(faviconBadge)

  useEffect(() => {
    if (!userId) {
      document.title = BASE_TITLE
      updateAppBadge(0)
      return
    }

    // Title format: "(N) VortexChat" for mentions, "• VortexChat" for unread-only
    if (mentionCount > 0) {
      document.title = `(${mentionCount}) VortexChat`
    } else if (totalUnread > 0) {
      document.title = `\u2022 VortexChat` // bullet dot
    } else {
      document.title = BASE_TITLE
    }

    updateAppBadge(totalUnread)
  }, [userId, totalUnread, mentionCount])
}
