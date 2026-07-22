"use client"

import { useMemo, useRef, useCallback } from "react"

interface SwipeConfig {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  minDistance?: number
  maxCrossAxis?: number
  /** Optional element that peeks in from the left edge during a rightward swipe. */
  peekElementSelector?: string
}

export function useSwipe({ onSwipeLeft, onSwipeRight, minDistance = 56, maxCrossAxis = 80, peekElementSelector }: SwipeConfig) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)

  const resetPeek = useCallback(() => {
    if (!peekElementSelector) return
    const el = document.querySelector(peekElementSelector) as HTMLElement | null
    if (el) {
      el.style.transition = "transform 200ms ease-out, opacity 200ms ease-out"
      el.style.transform = ""
      el.style.opacity = ""
      // Clean up after transition completes
      const cleanup = () => {
        el.style.transition = ""
        el.removeEventListener("transitionend", cleanup)
      }
      el.addEventListener("transitionend", cleanup)
    }
  }, [peekElementSelector])

  return useMemo(
    () => ({
      onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
        const touch = event.changedTouches[0]
        startRef.current = { x: touch.clientX, y: touch.clientY }
        activeRef.current = false
      },
      onTouchMove: (event: React.TouchEvent<HTMLElement>) => {
        const start = startRef.current
        if (!start || !peekElementSelector) return
        const touch = event.changedTouches[0]
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        // Ignore vertical scrolls
        if (Math.abs(dy) > maxCrossAxis) return
        // Only show peek for rightward swipes (opening sidebar)
        if (dx <= 0) return
        activeRef.current = true
        const el = document.querySelector(peekElementSelector) as HTMLElement | null
        if (el) {
          // Clamp translation: follow the finger up to minDistance, then rubber-band
          const maxPeek = minDistance * 1.5
          const clamped = dx > maxPeek ? maxPeek + (dx - maxPeek) * 0.2 : dx
          const progress = Math.min(clamped / maxPeek, 1)
          el.style.transition = "none"
          el.style.transform = `translateX(calc(-100% + ${clamped}px))`
          el.style.opacity = `${Math.min(progress, 0.85)}`
        }
      },
      onTouchEnd: (event: React.TouchEvent<HTMLElement>) => {
        const start = startRef.current
        if (!start) return
        const touch = event.changedTouches[0]
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        startRef.current = null
        if (activeRef.current) {
          resetPeek()
          activeRef.current = false
        }
        if (Math.abs(dy) > maxCrossAxis) return
        if (dx <= -minDistance) { navigator.vibrate?.(8); onSwipeLeft?.() }
        if (dx >= minDistance) { navigator.vibrate?.(8); onSwipeRight?.() }
      },
      onTouchCancel: (_event: React.TouchEvent<HTMLElement>): void => {
        startRef.current = null
        if (activeRef.current) {
          resetPeek()
          activeRef.current = false
        }
      },
    }),
    [maxCrossAxis, minDistance, onSwipeLeft, onSwipeRight, peekElementSelector, resetPeek]
  )
}
