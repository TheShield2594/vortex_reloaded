"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  DeviceMonitoringManager,
  type NewDeviceEvent,
} from "@/lib/webrtc/device-monitoring-manager"

export interface DevicePrompt {
  device: MediaDeviceInfo
  kind: "audioinput" | "audiooutput"
  detectedAt: number
}

/**
 * useDeviceMonitoring — React hook that wraps DeviceMonitoringManager.
 *
 * Returns the most recently detected new device (if any) so the voice UI
 * can show a "Switch to <device>?" prompt. The prompt auto-dismisses after
 * `dismissAfterMs` (default 10s) if the user doesn't act.
 */
export function useDeviceMonitoring(opts?: { dismissAfterMs?: number }) {
  const dismissMs = opts?.dismissAfterMs ?? 10_000
  const [prompt, setPrompt] = useState<DevicePrompt | null>(null)
  const managerRef = useRef<DeviceMonitoringManager | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const manager = new DeviceMonitoringManager({
      onNewDevice: (event: NewDeviceEvent) => {
        setPrompt({
          device: event.device,
          kind: event.kind,
          detectedAt: event.detectedAt,
        })
      },
    })
    managerRef.current = manager
    manager.start()

    return () => {
      manager.dispose()
      managerRef.current = null
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
      }
    }
  }, [])

  // Auto-dismiss
  useEffect(() => {
    if (!prompt) return
    dismissTimerRef.current = setTimeout(() => {
      setPrompt(null)
    }, dismissMs)
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = null
      }
    }
  }, [prompt, dismissMs])

  const dismiss = useCallback(() => setPrompt(null), [])

  return { prompt, dismiss }
}
