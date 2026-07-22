"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useReducedMotion } from "@/hooks/use-reduced-motion"

interface ImageLightboxProps {
  src: string
  alt: string
  onClose: () => void
  /** Additional images for navigation. Each entry is { src, alt }. */
  images?: Array<{ src: string; alt: string }>
  /** Index within images array to start at. Defaults to 0. */
  initialIndex?: number
}

/**
 * Full-screen image lightbox rendered via a React portal.
 * Supports zoom (click, scroll wheel, +/- keys), pan when zoomed,
 * left/right arrow navigation between images, and Escape to close.
 */
export function ImageLightbox({ src, alt, onClose, images, initialIndex = 0 }: ImageLightboxProps) {
  const reducedMotion = useReducedMotion()
  const imageList = images && images.length > 0 ? images : [{ src, alt }]
  const [currentIndex, setCurrentIndex] = useState(Math.min(initialIndex, imageList.length - 1))
  const [zoom, setZoom] = useState(1)
  const [panOrigin, setPanOrigin] = useState({ x: 50, y: 50 })
  const backdropRef = useRef<HTMLDivElement>(null)

  // Touch gesture state for pinch-to-zoom and swipe-to-dismiss
  const [swipeDismissY, setSwipeDismissY] = useState(0)
  const touchStartRef = useRef<{ touches: Array<{ x: number; y: number }>; distance: number; zoom: number; timestamp: number } | null>(null)
  const swipingRef = useRef(false)

  const safeIndex = Math.min(currentIndex, imageList.length - 1)
  const current = imageList[safeIndex]

  const resetZoom = useCallback(() => {
    setZoom(1)
    setPanOrigin({ x: 50, y: 50 })
  }, [])

  const move = useCallback((direction: 1 | -1) => {
    setCurrentIndex((prev) => (prev + direction + imageList.length) % imageList.length)
    resetZoom()
  }, [imageList.length, resetZoom])

  // Focus management: trap focus inside lightbox and restore on close
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    // Focus the backdrop container
    backdropRef.current?.focus()

    return () => {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus()
      }
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Tab trap
      if (e.key === "Tab") {
        const container = backdropRef.current
        if (!container) return
        const focusable = container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
        return
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault()
          onClose()
          break
        case "ArrowRight":
          e.preventDefault()
          if (imageList.length > 1) move(1)
          break
        case "ArrowLeft":
          e.preventDefault()
          if (imageList.length > 1) move(-1)
          break
        case "+":
        case "=":
          e.preventDefault()
          setZoom((prev) => Math.min(5, prev + 0.5))
          break
        case "-":
          e.preventDefault()
          setZoom((prev) => Math.max(1, prev - 0.5))
          break
        case "0":
          e.preventDefault()
          resetZoom()
          break
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose, move, imageList.length, resetZoom])

  // ── Touch gesture handlers (pinch-to-zoom + swipe-to-dismiss) ──────────
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touches = Array.from(e.touches).map((t) => ({ x: t.clientX, y: t.clientY }))
    let distance = 0
    if (touches.length === 2) {
      distance = Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y)
    }
    touchStartRef.current = { touches, distance, zoom, timestamp: Date.now() }
    swipingRef.current = false
  }, [zoom])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    if (!start) return

    // Pinch-to-zoom (two fingers)
    if (e.touches.length === 2 && start.touches.length === 2) {
      const newDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      )
      const scale = newDist / start.distance
      setZoom(Math.max(1, Math.min(5, start.zoom * scale)))
      return
    }

    // Single-finger swipe-to-dismiss (only when not zoomed)
    if (e.touches.length === 1 && start.touches.length === 1 && zoom <= 1) {
      const dy = e.touches[0].clientY - start.touches[0].y
      const dx = e.touches[0].clientX - start.touches[0].x
      // Only activate vertical swipe if it's more vertical than horizontal
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        swipingRef.current = true
        setSwipeDismissY(dy)
      }
    }

    // Single-finger pan when zoomed
    if (e.touches.length === 1 && zoom > 1) {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = ((e.touches[0].clientX - rect.left) / rect.width) * 100
      const y = ((e.touches[0].clientY - rect.top) / rect.height) * 100
      setPanOrigin({ x, y })
    }
  }, [zoom])

  const DISMISS_THRESHOLD = 100

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    if (swipingRef.current && start && e.changedTouches.length > 0) {
      const dy = e.changedTouches[0].clientY - start.touches[0].y
      if (Math.abs(dy) > DISMISS_THRESHOLD) {
        navigator.vibrate?.(8)
        onClose()
        touchStartRef.current = null
        return
      }
    }
    // Snap back
    setSwipeDismissY(0)
    swipingRef.current = false
    touchStartRef.current = null
  }, [onClose])

  const handleTouchCancel = useCallback(() => {
    setSwipeDismissY(0)
    swipingRef.current = false
    touchStartRef.current = null
  }, [])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) {
      onClose()
    }
  }, [onClose])

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (zoom === 1) {
      // Keyboard events don't have clientX/clientY — zoom to center
      if ("clientX" in e && typeof e.clientX === "number") {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        setPanOrigin({ x, y })
      } else {
        setPanOrigin({ x: 50, y: 50 })
      }
      setZoom(2)
    } else {
      resetZoom()
    }
  }, [zoom, resetZoom])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPanOrigin({ x, y })
  }, [zoom])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setZoom((prev) => {
      const next = prev + (e.deltaY < 0 ? 0.5 : -0.5)
      return Math.max(1, Math.min(5, next))
    })
  }, [])

  const lightbox = (
    <div
      ref={backdropRef}
      tabIndex={-1}
      className="fixed inset-0 z-[9999] flex items-center justify-center outline-none"
      style={{ background: "rgba(0, 0, 0, 0.85)" }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${current.alt}`}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
        style={{ color: "white" }}
        aria-label="Close lightbox"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="4" x2="16" y2="16" />
          <line x1="16" y1="4" x2="4" y2="16" />
        </svg>
      </button>

      {/* Navigation arrows */}
      {imageList.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); move(-1) }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "white" }}
            aria-label="Previous image"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="12,4 6,10 12,16" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); move(1) }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
            style={{ color: "white" }}
            aria-label="Next image"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8,4 14,10 8,16" />
            </svg>
          </button>
        </>
      )}

      {/* Image — supports pinch-to-zoom and swipe-to-dismiss on touch */}
      <div
        role="button"
        tabIndex={0}
        className="max-w-[90vw] max-h-[85vh] overflow-hidden touch-none"
        style={{
          cursor: zoom > 1 ? "zoom-out" : "zoom-in",
          transform: swipeDismissY !== 0 ? `translateY(${swipeDismissY}px)` : undefined,
          opacity: swipeDismissY !== 0 ? Math.max(0.2, 1 - Math.abs(swipeDismissY) / 300) : 1,
          transition: swipingRef.current ? "none" : !reducedMotion ? "transform 0.2s ease-out, opacity 0.2s ease-out" : "none",
        }}
        onClick={handleImageClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleImageClick(e) } }}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        aria-label={zoom > 1 ? "Zoom out" : "Zoom in"}
      >
        <img
          src={current.src}
          alt={current.alt}
          className="max-w-[90vw] max-h-[85vh] object-contain select-none"
          draggable={false}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: `${panOrigin.x}% ${panOrigin.y}%`,
            transition: zoom === 1 && !reducedMotion ? "transform 0.2s ease-out" : "none",
          }}
        />
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 text-xs px-4 py-2 rounded-full" style={{ color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.5)" }}>
        <span>{current.alt}</span>
        {imageList.length > 1 && (
          <span>{currentIndex + 1} / {imageList.length}</span>
        )}
        {zoom > 1 && (
          <span>{Math.round(zoom * 100)}%</span>
        )}
      </div>
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(lightbox, document.body)
}
