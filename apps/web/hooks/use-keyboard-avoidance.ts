"use client"

import { useEffect, useRef, type RefObject } from "react"

/**
 * On mobile, when the virtual keyboard opens the visual viewport shrinks.
 * This hook detects viewport size changes and scrolls the given container
 * so the message input stays visible. Uses the `visualViewport` API.
 *
 * Uses a debounced "resting height" to handle gradual keyboard animations
 * and a focus guard to avoid false positives from rotation/resize.
 *
 * @param scrollContainerRef - Ref to the scrollable message container
 * @param enabled - Whether to activate (typically `isMobile`)
 * @param columnReverse - If true, scrolls to top=0 (column-reverse bottom). If false, scrolls to scrollHeight.
 */
export function useKeyboardAvoidance(
  scrollContainerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  columnReverse = true
): void {
  const restingHeightRef = useRef<number>(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.visualViewport) return

    const viewport = window.visualViewport

    function isInputFocused(): boolean {
      const el = document.activeElement
      if (!el) return false
      const tag = el.tagName.toLowerCase()
      if (tag === "input" || tag === "textarea") return true
      if ((el as HTMLElement).isContentEditable) return true
      return false
    }

    function handleResize() {
      const currentHeight = viewport!.height

      // Keyboard opened — viewport got smaller and an input is focused
      if (restingHeightRef.current > 0 && currentHeight < restingHeightRef.current - 50 && isInputFocused()) {
        const container = scrollContainerRef.current
        if (container) {
          requestAnimationFrame(() => {
            if (columnReverse) {
              // column-reverse: scrollTop 0 = bottom (newest messages)
              container.scrollTo({ top: 0, behavior: "smooth" })
            } else {
              // Normal scroll: scroll to the very bottom
              container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
            }
          })
        }
      }

      // Update resting height only after resize events settle (debounce 150ms)
      // This handles gradual keyboard animation and avoids updating mid-transition
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => {
        // Only update resting height when keyboard is NOT open (viewport is large)
        if (!isInputFocused()) {
          restingHeightRef.current = viewport!.height
        }
      }, 150)
    }

    restingHeightRef.current = viewport.height
    viewport.addEventListener("resize", handleResize)
    return () => {
      viewport.removeEventListener("resize", handleResize)
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    }
  }, [enabled, scrollContainerRef, columnReverse])
}
