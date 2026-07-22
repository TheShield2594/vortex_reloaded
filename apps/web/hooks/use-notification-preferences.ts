"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export interface NotificationPreferences {
  mention_notifications: boolean
  reply_notifications: boolean
  friend_request_notifications: boolean
  server_invite_notifications: boolean
  system_notifications: boolean
  sound_enabled: boolean
  notification_volume: number
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_timezone: string
}

const DEFAULTS: NotificationPreferences = {
  mention_notifications: true,
  reply_notifications: true,
  friend_request_notifications: true,
  server_invite_notifications: true,
  system_notifications: true,
  sound_enabled: true,
  notification_volume: 0.5,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
  quiet_hours_timezone: "UTC",
}

// Module-level cache so multiple components share the same data
let cachedPrefs: NotificationPreferences = DEFAULTS
let cacheTimestamp = 0
const CACHE_TTL = 60_000 // 1 minute

/** Reset the cached preferences on logout so the next user doesn't inherit stale prefs. */
export function clearPreferencesCache(): void {
  cachedPrefs = DEFAULTS
  cacheTimestamp = 0
  notifyPrefsListeners()
}

const prefsListeners = new Set<() => void>()

function notifyPrefsListeners(): void {
  prefsListeners.forEach((cb) => cb())
}

/**
 * Fetches notification preferences from the API and caches them.
 * Returns the preferences or defaults on error.
 */
async function fetchPreferences(): Promise<NotificationPreferences> {
  try {
    const res = await fetch("/api/user/notification-preferences")
    if (!res.ok) return cachedPrefs
    const data: unknown = await res.json()
    if (typeof data !== "object" || data === null) return cachedPrefs
    // Merge with defaults to ensure all fields are present even if DB row is partial
    cachedPrefs = { ...DEFAULTS, ...(data as Partial<NotificationPreferences>) }
    cacheTimestamp = Date.now()
    notifyPrefsListeners()
    return cachedPrefs
  } catch {
    return cachedPrefs
  }
}

/**
 * Hook that provides the user's notification preferences from the DB.
 * Auto-fetches on mount (with cache) and provides a refresh function.
 */
export function useNotificationPreferences(userId: string | null): {
  prefs: NotificationPreferences
  refresh: () => Promise<void>
} {
  const [prefs, setPrefs] = useState<NotificationPreferences>(cachedPrefs)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Subscribe to cache updates from other hook instances
  useEffect(() => {
    const listener = () => {
      if (mountedRef.current) setPrefs(cachedPrefs)
    }
    prefsListeners.add(listener)
    return () => { prefsListeners.delete(listener) }
  }, [])

  useEffect(() => {
    if (!userId) return
    // Use cache if fresh
    if (Date.now() - cacheTimestamp < CACHE_TTL) {
      setPrefs(cachedPrefs)
      return
    }
    fetchPreferences().then((p) => {
      if (mountedRef.current) setPrefs(p)
    })
  }, [userId])

  const refresh = useCallback(async () => {
    const p = await fetchPreferences()
    if (mountedRef.current) setPrefs(p)
  }, [])

  return { prefs, refresh }
}

/**
 * Quick check: is sound enabled? Uses cached value (no hook needed).
 * This is useful for non-React contexts or performance-sensitive paths.
 */
export function isSoundEnabled(): boolean {
  return cachedPrefs.sound_enabled
}

/**
 * Quick read of cached notification volume (0–1). No hook needed.
 */
export function getNotificationVolume(): number {
  return cachedPrefs.notification_volume
}

/**
 * Pre-warm the preferences cache. Call once from AppProvider.
 */
export function prefetchNotificationPreferences(): void {
  if (Date.now() - cacheTimestamp < CACHE_TTL) return
  fetchPreferences()
}
