"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { isSoundEnabled } from "@/hooks/use-notification-preferences"
import { shouldNotify, showBrowserNotification } from "@/lib/notification-manager"
import { useGatewayContext } from "./use-gateway-context"
import type { VortexEvent } from "@vortex/shared"

/**
 * Global DM notification sound hook — mounted in AppProvider so it fires
 * even when the DMList component is not rendered (e.g. user is on a server).
 *
 * Listens for message.created gateway events across all of the user's DM
 * channels and plays a notification sound + shows browser notification when
 * appropriate.
 */
export function useDmNotificationSound(userId: string | null): void {
  const gateway = useGatewayContext()
  const { playNotification } = useNotificationSound()
  const playRef = useRef(playNotification)
  playRef.current = playNotification
  const [channelIds, setChannelIds] = useState<string[]>([])

  const refreshChannelIds = useCallback(async () => {
    if (!userId) {
      setChannelIds([])
      return
    }
    try {
      const res = await fetch("/api/dm/channels")
      if (!res.ok) return
      const data = (await res.json()) as Array<{ id: string }>
      setChannelIds(data.map((c) => c.id))
    } catch {
      // network failure — next membership change or reconnect will retry
    }
  }, [userId])

  useEffect(() => { void refreshChannelIds() }, [refreshChannelIds])

  // Re-fetch the channel list when we're added to or removed from a channel.
  useEffect(() => {
    if (!userId) return
    const removeListener = gateway.addEventListener(`user:${userId}`, (event: VortexEvent) => {
      if (event.type === "member.joined" || event.type === "member.left") void refreshChannelIds()
    })
    return () => removeListener()
  }, [userId, gateway, refreshChannelIds])

  const channelIdsKey = channelIds.join(",")

  // Sticky subscribe — see the note in dm-list.tsx on why this never
  // unsubscribes (shared gateway rooms across independent hooks).
  useEffect(() => {
    if (channelIds.length === 0) return
    gateway.subscribe(channelIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdsKey, gateway])

  useEffect(() => {
    if (!userId || channelIds.length === 0) return

    const removeListeners = channelIds.map((channelId) =>
      gateway.addEventListener(channelId, (event: VortexEvent) => {
        if (event.type !== "message.created") return
        if (event.actorId === userId) return

        const data = event.data as { messageId?: string; content?: string } | undefined

        const { shouldPlaySound, shouldShowBrowserNotification } = shouldNotify({
          dmChannelId: channelId,
          messageId: data?.messageId,
        })

        if (shouldPlaySound && isSoundEnabled()) {
          playRef.current("dm")
        }

        if (shouldShowBrowserNotification) {
          showBrowserNotification({
            title: "New Message",
            body: data?.content?.slice(0, 100) || "Sent a message",
            channelId,
            url: `/channels/me/${channelId}`,
          })
        }
      })
    )

    return () => { for (const remove of removeListeners) remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIdsKey, userId, gateway])
}
