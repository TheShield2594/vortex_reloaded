"use client"

import { useEffect, useRef, useState, useCallback } from "react"

const SW_UPDATE_POLL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Registers the service worker, polls for updates hourly,
 * detects when a new version is waiting, and manages the
 * `is-standalone` CSS class on the document element.
 */
export function useSwRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  const applyUpdate = useCallback(() => {
    const reg = registrationRef.current
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" })
    }
    // The controllerchange listener below will reload the page
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return

    // Toggle is-standalone class on <html> for conditional CSS
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (isStandalone) {
      document.documentElement.classList.add("is-standalone")
    }

    let pollTimer: ReturnType<typeof setInterval> | undefined
    let disposed = false
    let onUpdateFound: (() => void) | undefined

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (disposed) return
        registrationRef.current = reg

        // Detect a new worker waiting
        const onStateChange = () => {
          if (!disposed && reg.waiting) setUpdateAvailable(true)
        }

        onUpdateFound = () => {
          const newWorker = reg.installing
          newWorker?.addEventListener("statechange", onStateChange)
        }
        reg.addEventListener("updatefound", onUpdateFound)

        // Already waiting (e.g. page refresh after SW install)
        if (reg.waiting) setUpdateAvailable(true)

        // Poll for updates every hour
        pollTimer = setInterval(() => {
          reg.update().catch(() => {})
        }, SW_UPDATE_POLL_MS)

        // Register periodic background sync for unread badge updates
        registerPeriodicSync(reg)
      })
      .catch((err) => {
        console.warn("SW registration failed:", err)
      })

    // Handle pushsubscriptionchange forwarded from SW
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        // Re-trigger push subscription from the push-notifications hook
        window.dispatchEvent(new CustomEvent("vortex:resubscribe-push"))
      }
      if (event.data?.type === "NOTIFICATION_NAVIGATE") {
        const url = event.data.url
        if (url) {
          window.dispatchEvent(new CustomEvent("vortex:notification-navigate", { detail: { url } }))
        }
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage)

    // Reload when an *upgraded* SW takes control (not on first activation).
    // Without this guard, first-time visitors get an unexpected reload.
    const hadController = !!navigator.serviceWorker.controller
    let refreshing = false
    const onControllerChange = () => {
      if (!hadController) return // first install — no reload needed
      if (refreshing) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

    return () => {
      disposed = true
      if (pollTimer) clearInterval(pollTimer)
      const reg = registrationRef.current
      if (reg && onUpdateFound) reg.removeEventListener("updatefound", onUpdateFound)
      navigator.serviceWorker.removeEventListener("message", onMessage)
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
    }
  }, [])

  return { updateAvailable, applyUpdate }
}

/** Request periodic background sync to keep unread badges fresh when the app is closed. */
async function registerPeriodicSync(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    const periodicSync = (registration as ServiceWorkerRegistration & {
      periodicSync?: { register: (tag: string, opts: { minInterval: number }) => Promise<void> }
    }).periodicSync

    if (!periodicSync) return

    const status = await navigator.permissions.query({
      name: "periodic-background-sync" as PermissionName,
    })
    if (status.state !== "granted") return

    await periodicSync.register("vortex-refresh-unread", {
      minInterval: 60 * 60 * 1000, // 1 hour minimum
    })
  } catch {
    // Periodic sync not supported or permission denied — silently ignore
  }
}
