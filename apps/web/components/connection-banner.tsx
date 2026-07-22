"use client"

import type { ReactNode } from "react"
import { useConnectionStatus, type ConnectionState } from "@/hooks/use-connection-status"
import { WifiOff, RefreshCw, Loader2 } from "lucide-react"

const LABELS: Record<Exclude<ConnectionState, "connected">, { icon: ReactNode; text: string; variant: "danger" | "warning" }> = {
  offline: {
    icon: <WifiOff className="h-3.5 w-3.5" />,
    text: "No internet connection",
    variant: "danger",
  },
  disconnected: {
    icon: <WifiOff className="h-3.5 w-3.5" />,
    text: "Connection lost — retrying",
    variant: "warning",
  },
  reconnecting: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    text: "Reconnecting…",
    variant: "warning",
  },
}

/**
 * Subtle, scoped banner shown when the realtime connection is unhealthy.
 * Designed to sit inside the chat area (not fixed to the viewport) so it
 * feels informational rather than alarming — similar to Discord/Slack.
 *
 * A 2.5 s grace period in the connection-status FSM means this banner only
 * appears for genuine, persistent disconnections.
 */
export function ConnectionBanner(): ReactNode {
  const { status, retry } = useConnectionStatus()

  if (status === "connected") return null

  const { icon, text, variant } = LABELS[status]

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium shrink-0"
      style={{
        background: variant === "danger"
          ? "var(--theme-danger, #e53e3e)"
          : "var(--theme-warning-subtle, rgba(214, 158, 46, 0.15))",
        color: variant === "danger"
          ? "#fff"
          : "var(--theme-warning-text, #b7791f)",
      }}
    >
      {icon}
      <span>{text}</span>
      {status !== "reconnecting" && (
        <button
          type="button"
          onClick={retry}
          className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold hover:opacity-80"
          style={{
            background: variant === "danger"
              ? "rgba(255,255,255,0.2)"
              : "rgba(214, 158, 46, 0.2)",
          }}
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  )
}
