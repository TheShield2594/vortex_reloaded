"use client"

import { useEffect, useRef } from "react"
import { useAppearanceStore } from "@/lib/stores/appearance-store"

/**
 * useAutoSyncAppearance — when `syncToAccount` is enabled, debounces and
 * persists the current appearance settings to the user profile API whenever
 * a setting changes. Should be called from any settings page that modifies
 * appearance values.
 */
export function useAutoSyncAppearance(): void {
  const syncToAccount = useAppearanceStore((s) => s.syncToAccount)
  const toSettingsPayload = useAppearanceStore((s) => s.toSettingsPayload)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Serialize the payload so we can use it as a dependency.
  // This ensures the effect fires on every meaningful setting change.
  const payloadJson = JSON.stringify(toSettingsPayload())

  useEffect(() => {
    mountedRef.current = true
    return (): void => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!syncToAccount) return

    // Debounce: wait 1.5s after the last change before persisting
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return

      const payload = JSON.parse(payloadJson) as Record<string, unknown>

      fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance_settings: payload }),
      }).catch(() => {
        // Silently fail — settings are still persisted locally via zustand.
        // The next profile save from the modal will pick them up.
      })
    }, 1500)

    return (): void => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [syncToAccount, payloadJson])
}
