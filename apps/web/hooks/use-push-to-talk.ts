"use client"

import { useEffect, useRef, useCallback } from "react"

/**
 * Push-to-talk hook.
 * While the configured key is held down, `onActivate()` is called once.
 * When released, `onDeactivate()` is called.
 *
 * Default PTT key: Space (stored in localStorage as "ptt_key").
 */
export function usePushToTalk(
  enabled: boolean,
  onActivate: () => void,
  onDeactivate: () => void
) {
  const activeRef = useRef(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const getPttKey = useCallback(() => {
    if (typeof window === "undefined") return null
    return localStorage.getItem("ptt_key") ?? "Space"
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!enabledRef.current) return
      // Ignore when typing in inputs
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return

      const pttKey = getPttKey()
      if (pttKey && (e.code === pttKey || e.key === pttKey)) {
        if (!activeRef.current) {
          activeRef.current = true
          onActivate()
        }
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (!enabledRef.current) return
      const pttKey = getPttKey()
      if (pttKey && (e.code === pttKey || e.key === pttKey)) {
        if (activeRef.current) {
          activeRef.current = false
          onDeactivate()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      // Ensure we deactivate on unmount
      if (activeRef.current) {
        activeRef.current = false
        onDeactivate()
      }
    }
  }, [onActivate, onDeactivate, getPttKey])
}
