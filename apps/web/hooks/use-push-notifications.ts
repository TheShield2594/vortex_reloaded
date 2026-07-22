"use client"

import { useEffect, useCallback } from "react"

const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

/** Module-level flag so the resubscribed toast fires at most once per app lifetime,
 *  even if multiple components mount usePushNotifications. */
let wasResubscribedGlobal = false

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  return Uint8Array.from(Array.from(rawData).map((char) => char.charCodeAt(0)))
}

export function usePushNotifications() {
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false
    if (!PUBLIC_VAPID_KEY) return false

    try {
      // iOS Safari requires Notification.requestPermission() to be called
      // synchronously within the user gesture's microtask.  Any preceding
      // await (SW ready, getRegistration, register) breaks the gesture
      // chain and causes iOS to silently deny the permission.
      // Request permission FIRST, then resolve the SW registration.
      const permission = await Notification.requestPermission()
      if (permission !== "granted") return false

      // Prefer .ready (resolved by useSwRegistration's register call).
      // If no SW is registered yet (e.g. SwUpdateToast not mounted), fall
      // back to getRegistration() then register() so push doesn't hang.
      let registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<ServiceWorkerRegistration | undefined>((resolve) => setTimeout(resolve, 3000)),
      ])
      if (!registration) {
        registration = await navigator.serviceWorker.getRegistration("/")
      }
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      }

      // On iOS, stale push endpoints silently fail — pushes are accepted
      // by the push service but never delivered to the device.  Force a
      // fresh subscription every time on iOS to avoid this.
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
      const existing = await registration.pushManager.getSubscription()

      let subscription: PushSubscription
      if (existing && isIOS) {
        // Unsubscribe the stale endpoint, then create a fresh one
        await existing.unsubscribe()
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
        })
      } else {
        subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
          }))
      }

      const { endpoint, keys } = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> }

      // Detect endpoint mismatch: if we had an existing subscription but
      // the endpoint changed, the browser rotated keys (common after iOS
      // SW eviction).  Flag it so we can notify the user.
      const endpointChanged = existing !== null && existing.endpoint !== subscription.endpoint

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, keys }),
      })
      if (!res.ok) {
        console.warn("Push subscription server registration failed:", res.status)
        return false
      }

      // Show a toast when push was silently re-enabled (e.g. after iOS SW eviction)
      if ((isIOS || endpointChanged) && !wasResubscribedGlobal) {
        wasResubscribedGlobal = true
        window.dispatchEvent(new CustomEvent("vortex:push-resubscribed"))
      }

      return true
    } catch (e) {
      // AbortError is expected when the push service is unavailable (dev,
      // unsupported browsers, restricted environments).  Log at debug
      // level to avoid spamming the console.
      if (e instanceof DOMException && e.name === "AbortError") {
        console.debug("Push subscription unavailable (push service error) — skipping")
      } else {
        console.warn("Push notification setup failed:", e)
      }
      return false
    }
  }, [])

  useEffect(() => {
    // Auto-subscribe if already granted.
    // Guard typeof Notification: on iOS Safari < 16.4 and some Android WebViews
    // the Notification global is not defined at all.  Accessing it without this
    // check throws a ReferenceError that React 18 routes to the nearest error
    // boundary, producing the "Something went wrong" screen on mobile.
    if (
      typeof window !== "undefined" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      subscribe()
    }

    // Re-subscribe when the browser rotates push keys (forwarded from SW
    // via useSwRegistration → vortex:resubscribe-push custom event)
    const onResubscribe = () => subscribe()
    window.addEventListener("vortex:resubscribe-push", onResubscribe)
    return () => window.removeEventListener("vortex:resubscribe-push", onResubscribe)
  }, [subscribe])

  return { subscribe }
}
