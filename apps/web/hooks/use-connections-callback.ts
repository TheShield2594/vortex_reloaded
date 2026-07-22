"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"

type ToastFn = (props: {
  title?: string
  description?: string
  variant?: "default" | "destructive"
}) => void

export function useConnectionsCallback(
  loadConnections: () => Promise<void>,
  toast: ToastFn,
  router: AppRouterInstance,
): void {
  const searchParams = useSearchParams()

  useEffect(() => {
    const connectionStatus = searchParams.get("connections")
    if (!connectionStatus) return

    if (connectionStatus === "youtube_linked" || connectionStatus === "steam_linked") {
      const provider = connectionStatus.startsWith("youtube") ? "YouTube" : "Steam"
      toast({ title: `${provider} connected!` })
      loadConnections()
    } else if (connectionStatus.startsWith("youtube_") || connectionStatus.startsWith("steam_")) {
      const provider = connectionStatus.startsWith("youtube") ? "YouTube" : "Steam"
      toast({ variant: "destructive", title: `Failed to connect ${provider}`, description: connectionStatus.replace(/_/g, " ") })
    }

    const url = new URL(window.location.href)
    url.searchParams.delete("connections")
    router.replace(url.pathname + url.search, { scroll: false })
  }, [searchParams, toast, loadConnections, router])
}
