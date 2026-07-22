"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Bell, X } from "lucide-react"
import { usePushNotifications } from "@/hooks/use-push-notifications"

const STORAGE_KEY = "vortex-push-prompt-dismissed"
// Show sooner on installed PWA (30s) since users expect notifications
// from installed apps. Regular browser gets 60s delay.
const SHOW_AFTER_MS_PWA = 30_000
const SHOW_AFTER_MS_BROWSER = 60_000

/**
 * Soft-ask prompt for push notification permission.
 * Appears after the user has been active for a while, so we don't
 * immediately hit them with the browser permission dialog on first visit.
 */
export function PushPermissionPrompt() {
  const [visible, setVisible] = useState(false)
  const { subscribe } = usePushNotifications()

  useEffect(() => {
    if (typeof window === "undefined") return
    if (typeof Notification === "undefined") return
    // Already granted or denied — don't show the soft-ask
    if (Notification.permission !== "default") return
    // User previously dismissed
    if (localStorage.getItem(STORAGE_KEY)) return
    // Not supported
    if (!("PushManager" in window)) return

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true
    const delay = isStandalone ? SHOW_AFTER_MS_PWA : SHOW_AFTER_MS_BROWSER
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1")
    setVisible(false)
  }

  async function enable() {
    try {
      const success = await subscribe()
      if (success) {
        setVisible(false)
        localStorage.setItem(STORAGE_KEY, "1")
        return
      }
      // If the user hard-denied via the browser dialog, permanently dismiss —
      // the prompt is no longer actionable and showing it is confusing.
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setVisible(false)
        localStorage.setItem(STORAGE_KEY, "1")
        return
      }
      // Transient failure (SW not ready, network error) — keep prompt visible
      // so the user can retry or dismiss manually.
    } catch {
      // subscribe() threw — keep prompt visible so user can retry
    }
  }

  if (!visible) return null

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-4 right-4 z-banner-high mx-auto max-w-sm rounded-xl border p-4 shadow-xl md:left-auto md:right-6 md:bottom-6"
      style={{
        background: "var(--theme-bg-secondary)",
        borderColor: "var(--theme-bg-tertiary)",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-2 right-2 p-1 rounded-md hover:opacity-80"
        aria-label="Dismiss notification prompt"
      >
        <X className="w-4 h-4" style={{ color: "var(--theme-text-muted)" }} />
      </button>
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: "rgba(0,229,255,0.15)" }}
        >
          <Bell className="h-5 w-5" style={{ color: "#00e5ff" }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>
            Stay in the loop
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--theme-text-secondary)" }}>
            Enable notifications so you never miss a message or mention.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={dismiss}>
              Not now
            </Button>
            <Button variant="default" size="sm" onClick={enable}>
              Enable
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
