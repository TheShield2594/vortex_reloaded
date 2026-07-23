"use client"

import { useEffect } from "react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { useAppearanceStore } from "@/lib/stores/appearance-store"
import { useApplyAppearance } from "@/hooks/use-apply-appearance"
import { useGatewayPresence } from "@/hooks/use-gateway-presence"
import { GatewayProvider, useGatewayContext } from "@/hooks/use-gateway-context"
import { usePushNotifications } from "@/hooks/use-push-notifications"
import { useTabUnreadTitle } from "@/hooks/use-tab-unread-title"
import { useGifAutoplay } from "@/hooks/use-gif-autoplay"
import { prefetchNotificationPreferences, clearPreferencesCache } from "@/hooks/use-notification-preferences"
import { useDmNotificationSound } from "@/hooks/use-dm-notification-sound"
import { useNotificationCountSync } from "@/hooks/use-notification-count-sync"
import { useToast } from "@/components/ui/use-toast"
import { setActiveChannel as setNotifManagerActiveChannel } from "@/lib/notification-manager"
import type { UserRow } from "@/types/database"

interface AppProviderProps {
  user: UserRow | null
  children: React.ReactNode
}

/** Root client-side provider that seeds Zustand stores, syncs presence, applies appearance settings, and registers push notifications. */
export function AppProvider({ user, children }: AppProviderProps) {
  return (
    <GatewayProvider>
      <AppProviderInner user={user}>{children}</AppProviderInner>
    </GatewayProvider>
  )
}

function AppProviderInner({ user, children }: AppProviderProps): React.ReactNode {
  const { setCurrentUser, loadNotificationSettings } = useAppStore(
    useShallow((s) => ({ setCurrentUser: s.setCurrentUser, loadNotificationSettings: s.loadNotificationSettings }))
  )
  const { gifAutoplay, hydrateFromSettings } = useAppearanceStore(
    useShallow((s) => ({
      gifAutoplay: s.gifAutoplay,
      hydrateFromSettings: s.hydrateFromSettings,
    }))
  )

  // Apply all appearance data-attributes and CSS custom properties to <html>
  useApplyAppearance()

  useEffect(() => {
    setCurrentUser(user)
    hydrateFromSettings(user?.appearance_settings as Parameters<typeof hydrateFromSettings>[0], user?.id ?? null)
    if (user) {
      void loadNotificationSettings()
      // Pre-warm notification preferences cache (sound_enabled, quiet hours, etc.)
      prefetchNotificationPreferences()
    } else {
      // Clear cached prefs on logout so next user doesn't inherit stale values
      clearPreferencesCache()
      // Clear SW API cache to prevent cross-account data leaks
      navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" })
    }
  }, [user, setCurrentUser, hydrateFromSettings, loadNotificationSettings])

  // Auto-sync presence: marks user online on mount, offline on tab close
  useGatewayPresence(user?.id ?? null, user?.status ?? "online")

  // Join the per-user gateway channel — carries notification.created and
  // cross-channel member.joined/left notices (a DM channel the user was
  // just added to or removed from, before their client has a room to
  // receive per-channel events on). Individual hooks below listen via
  // gateway.addEventListener("user:{id}", ...) without managing their own
  // subscribe/unsubscribe, since only one owner should manage this room's
  // lifecycle per socket.
  const gateway = useGatewayContext()
  useEffect(() => {
    if (!user?.id) return
    const userChannel = `user:${user.id}`
    gateway.subscribe([userChannel])
    return () => { gateway.unsubscribe([userChannel]) }
  }, [user?.id, gateway])

  // GIF autoplay: freeze/restore GIF images based on user preference
  useGifAutoplay(gifAutoplay)

  // Register service worker + push notifications if previously granted
  usePushNotifications()
  useTabUnreadTitle(user?.id ?? null)

  // Show toast when push notifications were re-enabled after iOS SW eviction
  const { toast } = useToast()
  useEffect(() => {
    const handler = () => {
      toast({ title: "Push notifications were re-enabled", description: "Your notification subscription was refreshed." })
    }
    window.addEventListener("vortex:push-resubscribed", handler)
    return () => window.removeEventListener("vortex:push-resubscribed", handler)
  }, [toast])

  // Global DM notification sound — always mounted so DM sounds fire from anywhere in the app
  useDmNotificationSound(user?.id ?? null)

  // Global notification count sync — ensures mobile tab bar badge is accurate
  useNotificationCountSync(user?.id ?? null)

  // Sync Zustand activeChannelId to the notification manager so it can
  // suppress sounds/notifications when the user is viewing a channel
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  useEffect(() => {
    setNotifManagerActiveChannel(activeChannelId)
  }, [activeChannelId])

  return <>{children}</>
}
