"use client"

import { useEffect, useState } from "react"
import { WifiOff, RefreshCw, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"

const RECONNECT_DELAY_MS = 2000

export default function OfflinePage(): React.ReactElement {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : false
  )
  const [reconnected, setReconnected] = useState(false)

  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = (): void => setIsOnline(true)
    const handleOffline = (): void => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!isOnline) {
      setReconnected(false)
      return
    }
    // Show "Connection restored" briefly before navigating
    setReconnected(true)
    const timer = setTimeout(() => {
      window.location.replace("/channels/me")
    }, RECONNECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isOnline])

  function handleContinue(): void {
    window.location.replace("/channels/me")
  }

  if (reconnected) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center"
        style={{ background: "var(--theme-bg-primary, #1b1f31)" }}
      >
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: "rgba(0,229,255,0.15)" }}
        >
          <Wifi className="h-10 w-10" style={{ color: "#00e5ff" }} />
        </div>

        <div>
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--theme-text-primary, #e8ecf4)" }}
          >
            Connection restored
          </h1>
          <p
            className="mt-2 max-w-xs text-sm"
            style={{ color: "var(--theme-text-secondary, #8f9bbf)" }}
          >
            Taking you back to VortexChat…
          </p>
        </div>

        <Button variant="default" onClick={handleContinue} className="gap-2">
          Continue now
        </Button>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: "var(--theme-bg-primary, #1b1f31)" }}
    >
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full"
        style={{ background: "rgba(0,229,255,0.1)" }}
      >
        <WifiOff className="h-10 w-10" style={{ color: "#00e5ff" }} />
      </div>

      <div>
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--theme-text-primary, #e8ecf4)" }}
        >
          You're offline
        </h1>
        <p
          className="mt-2 max-w-xs text-sm"
          style={{ color: "var(--theme-text-secondary, #8f9bbf)" }}
        >
          VortexChat needs an internet connection to load new messages. Check your Wi-Fi or mobile data and try again.
        </p>
      </div>

      <Button
        variant="default"
        onClick={() => window.location.reload()}
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  )
}
