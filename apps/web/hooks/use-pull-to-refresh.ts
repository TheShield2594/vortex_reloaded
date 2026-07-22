"use client"

import { useRef, useCallback, useState } from "react"

/** Default pull distance (px) required to trigger refresh. */
export const PULL_REFRESH_THRESHOLD = 80

interface PullToRefreshConfig {
  /** Called when the user completes a pull-down gesture. Should return a promise. */
  onRefresh: () => Promise<void>
  /** Minimum pull distance in px to trigger refresh. Default 80. */
  threshold?: number
  /** Whether the scrollable is at the top (scrollTop <= 0). */
  isAtTop: boolean
}

interface PullToRefreshResult {
  /** Spread these onto the scrollable container element. */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    onTouchCancel: () => void
  }
  /** Current pull distance (0 when idle). Use for rendering a pull indicator. */
  pullDistance: number
  /** Whether a refresh is currently in progress. */
  refreshing: boolean
  /** The resolved threshold value. */
  threshold: number
}

/**
 * Adds pull-to-refresh gesture to a scrollable container on mobile.
 * Only activates when the container is scrolled to the top.
 */
export function usePullToRefresh({ onRefresh, threshold = PULL_REFRESH_THRESHOLD, isAtTop }: PullToRefreshConfig): PullToRefreshResult {
  const startYRef = useRef<number | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pullingRef = useRef(false)
  // Refs for values needed in stable callbacks to avoid re-creating handlers
  const pullDistanceRef = useRef(0)
  const isAtTopRef = useRef(isAtTop)
  const refreshingRef = useRef(false)
  isAtTopRef.current = isAtTop
  refreshingRef.current = refreshing
  pullDistanceRef.current = pullDistance

  const reset = useCallback((): void => {
    startYRef.current = null
    pullingRef.current = false
    setPullDistance(0)
    pullDistanceRef.current = 0
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent): void => {
    if (refreshingRef.current) return
    // Only arm the pull gesture if we're at the top
    if (isAtTopRef.current) {
      startYRef.current = e.touches[0].clientY
      pullingRef.current = false
      setPullDistance(0)
      pullDistanceRef.current = 0
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent): void => {
    if (refreshingRef.current || startYRef.current === null) return
    const dy = e.touches[0].clientY - startYRef.current
    if (dy > 0 && isAtTopRef.current) {
      pullingRef.current = true
      const dampened = dy > threshold ? threshold + (dy - threshold) * 0.3 : dy
      setPullDistance(dampened)
      pullDistanceRef.current = dampened
    } else if (pullingRef.current && dy <= 0) {
      reset()
    }
  }, [threshold, reset])

  const onTouchEnd = useCallback((): void => {
    if (refreshingRef.current) return
    if (pullingRef.current && pullDistanceRef.current >= threshold) {
      navigator.vibrate?.(12)
      setRefreshing(true)
      refreshingRef.current = true
      setPullDistance(threshold * 0.5)
      ;(async () => {
        try {
          await onRefresh()
        } catch (error) {
          console.error("Pull-to-refresh onRefresh error:", error)
        } finally {
          setRefreshing(false)
          refreshingRef.current = false
          reset()
        }
      })()
    } else {
      reset()
    }
  }, [threshold, onRefresh, reset])

  const onTouchCancel = useCallback((): void => {
    if (!refreshingRef.current) reset()
  }, [reset])

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    pullDistance,
    refreshing,
    threshold,
  }
}