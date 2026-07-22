"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Share } from "lucide-react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const STORAGE_KEY = "pwa-install-banner-dismissed"
const IOS_DISMISS_KEY = "pwa-install-banner-ios-dismissed-at"
const IOS_REDISPLAY_DAYS = 7

/** Detect iOS Safari (not Chrome/Firefox on iOS which also can't install PWAs but show differently) */
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  // CriOS = Chrome iOS, FxiOS = Firefox iOS, EdgiOS = Edge iOS
  const isSafari = !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(ua)
  return isIos && isSafari
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(display-mode: standalone)").matches ||
    Reflect.get(navigator, "standalone") === true
}

export function PwaInstallBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return
    if (isStandalone()) return

    // iOS Safari path — show manual install instructions
    if (isIosSafari()) {
      // Re-show after IOS_REDISPLAY_DAYS if previously dismissed (not permanently hidden)
      const dismissedAt = localStorage.getItem(IOS_DISMISS_KEY)
      if (dismissedAt) {
        const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24)
        if (daysSince < IOS_REDISPLAY_DAYS) return
      }
      setShowIosGuide(true)
      setVisible(true)
      return
    }

    // Android/Chrome path — use beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  function dismiss(permanent = false): void {
    if (showIosGuide && !permanent) {
      // iOS: soft dismiss — re-show after IOS_REDISPLAY_DAYS
      localStorage.setItem(IOS_DISMISS_KEY, String(Date.now()))
    } else {
      localStorage.setItem(STORAGE_KEY, "1")
    }
    setVisible(false)
  }

  async function install() {
    if (!promptEvent) return
    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice
      if (outcome === "accepted" || outcome === "dismissed") {
        localStorage.setItem(STORAGE_KEY, "1")
        setVisible(false)
      }
    } catch {
      // prompt() can throw if called more than once or if the browser cancels — dismiss gracefully
      setVisible(false)
    }
  }

  if (!visible) return null

  return (
    <div
      role="banner"
      aria-label="Add VortexChat to your home screen"
      className="fixed left-0 right-0 z-banner flex items-center gap-3 border-t border-accent bg-card px-4 py-3 shadow-lg md:bottom-0"
      style={{ bottom: "var(--mobile-tabbar-reserve)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="VortexChat icon" width={40} height={40} className="shrink-0 rounded-lg" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Add VortexChat to Home Screen</p>
        {showIosGuide ? (
          <>
            <p className="text-xs text-muted-foreground">
              Get notifications, offline access &amp; a full-screen experience.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tap <Share className="inline h-3.5 w-3.5 -mt-0.5 mx-0.5" aria-label="Share" /> below, scroll down, then tap &quot;Add to Home Screen&quot;.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Get the full app experience — offline support &amp; fast launch.
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        {showIosGuide ? (
          <>
            <Button variant="outline" size="sm" onClick={() => dismiss(false)} aria-label="Dismiss install banner">
              Not now
            </Button>
            <Button variant="default" size="sm" onClick={() => dismiss(true)} aria-label="Acknowledge install instructions">
              Got it
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => dismiss(false)} aria-label="Dismiss install banner">
              Not now
            </Button>
            <Button variant="default" size="sm" onClick={install} aria-label="Install VortexChat app">
              Install
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
