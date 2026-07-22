"use client"

import { useEffect, useRef } from "react"

const FAVICON_SIZE = 32
const BADGE_COLOR = "#ED4245" // Discord/Fluxer red

/**
 * Badge values:
 *   0        → no badge, restore original favicon
 *   -1       → unread dot indicator (•) — unreads but no mentions
 *   1..N     → numeric mention count badge
 *
 * Matches Fluxer's AppBadge component behavior:
 *   - mentionCount > 0   → numeric badge
 *   - hasUnread only      → dot (•)
 *   - nothing             → clear
 */

// UNREAD_INDICATOR sentinel — means "show dot, not number"
export const UNREAD_INDICATOR = -1

type BadgeValue = number // 0 = clear, -1 = dot, >0 = numeric

// ---------------------------------------------------------------------------
// Canvas rendering helpers
// ---------------------------------------------------------------------------

function drawBadgeDot(
  ctx: CanvasRenderingContext2D,
): void {
  const radius = 5
  const cx = FAVICON_SIZE - radius - 1
  const cy = radius + 1
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
  ctx.fillStyle = BADGE_COLOR
  ctx.fill()
  ctx.strokeStyle = "#FFFFFF"
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function drawBadgeNumber(
  ctx: CanvasRenderingContext2D,
  count: number,
): void {
  const text = count > 99 ? "99+" : String(count)
  // Measure text to size the pill
  ctx.font = "bold 12px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const metrics = ctx.measureText(text)
  const textWidth = metrics.width

  const height = 14
  const padding = 3
  const width = Math.max(height, textWidth + padding * 2)
  const radius = height / 2

  // Position: top-right corner
  const x = FAVICON_SIZE - width - 0.5
  const y = 0.5

  // Draw pill background
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.arc(x + width - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x + radius, y + height)
  ctx.arc(x + radius, y + radius, radius, Math.PI / 2, -Math.PI / 2)
  ctx.closePath()
  ctx.fillStyle = BADGE_COLOR
  ctx.fill()
  ctx.strokeStyle = "#FFFFFF"
  ctx.lineWidth = 1
  ctx.stroke()

  // Draw text
  ctx.fillStyle = "#FFFFFF"
  ctx.fillText(text, x + width / 2, y + height / 2 + 0.5)
}

function drawFaviconWithBadge(
  baseImage: HTMLImageElement | null,
  badge: BadgeValue,
): string | null {
  const canvas = document.createElement("canvas")
  canvas.width = FAVICON_SIZE
  canvas.height = FAVICON_SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  // Draw base favicon
  if (baseImage) {
    ctx.drawImage(baseImage, 0, 0, FAVICON_SIZE, FAVICON_SIZE)
  } else {
    // Fallback: draw a branded placeholder
    ctx.fillStyle = "#5865F2"
    ctx.fillRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
    ctx.fillStyle = "#FFFFFF"
    ctx.font = "bold 22px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("V", FAVICON_SIZE / 2, FAVICON_SIZE / 2 + 1)
  }

  // Draw badge overlay
  if (badge === UNREAD_INDICATOR) {
    drawBadgeDot(ctx)
  } else if (badge > 0) {
    drawBadgeNumber(ctx, badge)
  }

  return canvas.toDataURL("image/png")
}

// ---------------------------------------------------------------------------
// Preload the base favicon image once
// ---------------------------------------------------------------------------

let baseImageCache: HTMLImageElement | null = null
let baseImageLoading = false
const baseImageCallbacks: Array<(img: HTMLImageElement | null) => void> = []

function loadBaseImage(href: string): Promise<HTMLImageElement | null> {
  if (baseImageCache) return Promise.resolve(baseImageCache)

  return new Promise((resolve) => {
    baseImageCallbacks.push(resolve)
    if (baseImageLoading) return

    baseImageLoading = true
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      baseImageCache = img
      baseImageLoading = false
      for (const cb of baseImageCallbacks) cb(img)
      baseImageCallbacks.length = 0
    }
    img.onerror = () => {
      baseImageCache = null
      baseImageLoading = false
      for (const cb of baseImageCallbacks) cb(null)
      baseImageCallbacks.length = 0
    }
    img.src = href
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Dynamically renders a badge on the browser tab favicon.
 *
 * @param badge  0 = clear, -1 = dot (unread indicator), >0 = numeric count
 */
export function useFaviconBadge(badge: BadgeValue): void {
  const originalHrefRef = useRef<string | null>(null)
  const linkRef = useRef<HTMLLinkElement | null>(null)
  const prevBadgeRef = useRef<BadgeValue>(0)

  useEffect(() => {
    if (typeof document === "undefined") return

    // Find or create the favicon link element
    let link = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][sizes="32x32"]'
    )
    if (!link) {
      link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    }
    if (!link) {
      link = document.createElement("link")
      link.rel = "icon"
      link.type = "image/png"
      link.sizes = "32x32"
      document.head.appendChild(link)
    }

    linkRef.current = link

    // Store the original href on first mount
    if (originalHrefRef.current === null) {
      originalHrefRef.current = link.href
    }

    // Skip redundant updates
    if (badge === prevBadgeRef.current && badge !== 0) return
    prevBadgeRef.current = badge

    if (badge === 0) {
      // Restore original favicon
      if (originalHrefRef.current) {
        link.href = originalHrefRef.current
      }
      return
    }

    // Load base image and composite the badge
    const src = originalHrefRef.current || "/favicon-32x32.png?v=2"
    loadBaseImage(src).then((img) => {
      const dataUrl = drawFaviconWithBadge(img, badge)
      if (dataUrl && linkRef.current) {
        linkRef.current.href = dataUrl
      }
    })
  }, [badge])

  // Cleanup: restore original favicon on unmount only (not on every badge change)
  useEffect(() => {
    return () => {
      if (linkRef.current && originalHrefRef.current) {
        linkRef.current.href = originalHrefRef.current
      }
    }
  }, [])
}
