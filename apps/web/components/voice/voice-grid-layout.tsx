"use client"

import { useMemo, type ReactNode } from "react"
import { useMobileLayout } from "@/hooks/use-mobile-layout"

// ── Types ────────────────────────────────────────────────────────────────────

interface VoiceGridLayoutProps {
  /** Total number of participants (including self). */
  participantCount: number
  /** Whether any participant has video enabled (camera or screen share). */
  hasVideo: boolean
  /** Children to render in the grid (one per participant tile). */
  children: ReactNode
}

// ── Grid config per participant count ────────────────────────────────────────

interface GridConfig {
  columns: number
  rows: number
  /** CSS grid-template-columns value */
  templateColumns: string
  /** Max height per tile (CSS value). */
  maxTileHeight?: string
}

/**
 * Compute the optimal grid layout for a given participant count.
 *
 * For audio-only calls, tiles are smaller (avatar + name badge).
 * For video calls, tiles need to be larger to show camera feeds
 * in a proper grid that looks like a real video conferencing app.
 */
function computeGridConfig(count: number, hasVideo: boolean, isMobile: boolean): GridConfig {
  if (!hasVideo) {
    // Audio-only: compact tiles — use fewer columns on mobile
    if (isMobile) {
      if (count === 1) return { columns: 1, rows: 1, templateColumns: "1fr" }
      return { columns: 2, rows: Math.ceil(count / 2), templateColumns: "repeat(2, 1fr)" }
    }
    if (count <= 2) return { columns: 2, rows: 1, templateColumns: "repeat(2, minmax(180px, 1fr))" }
    if (count <= 4) return { columns: 2, rows: 2, templateColumns: "repeat(2, minmax(180px, 1fr))" }
    if (count <= 9) return { columns: 3, rows: 3, templateColumns: "repeat(3, minmax(160px, 1fr))" }
    if (count <= 16) return { columns: 4, rows: 4, templateColumns: "repeat(4, minmax(140px, 1fr))" }
    return { columns: 5, rows: Math.ceil(count / 5), templateColumns: "repeat(5, minmax(120px, 1fr))" }
  }

  // Video: larger tiles with proper aspect ratios
  if (isMobile) {
    // Mobile video: max 2 columns, stacked vertically
    if (count === 1) return { columns: 1, rows: 1, templateColumns: "1fr", maxTileHeight: "60vh" }
    if (count === 2) return { columns: 1, rows: 2, templateColumns: "1fr", maxTileHeight: "45vh" }
    if (count <= 4) return { columns: 2, rows: 2, templateColumns: "repeat(2, 1fr)", maxTileHeight: "40vh" }
    return { columns: 2, rows: Math.ceil(count / 2), templateColumns: "repeat(2, 1fr)", maxTileHeight: "30vh" }
  }
  if (count === 1) return { columns: 1, rows: 1, templateColumns: "1fr", maxTileHeight: "80vh" }
  if (count === 2) return { columns: 2, rows: 1, templateColumns: "repeat(2, 1fr)", maxTileHeight: "70vh" }
  if (count <= 4) return { columns: 2, rows: 2, templateColumns: "repeat(2, 1fr)", maxTileHeight: "45vh" }
  if (count <= 6) return { columns: 3, rows: 2, templateColumns: "repeat(3, 1fr)", maxTileHeight: "45vh" }
  if (count <= 9) return { columns: 3, rows: 3, templateColumns: "repeat(3, 1fr)", maxTileHeight: "30vh" }
  if (count <= 12) return { columns: 4, rows: 3, templateColumns: "repeat(4, 1fr)", maxTileHeight: "30vh" }
  if (count <= 16) return { columns: 4, rows: 4, templateColumns: "repeat(4, 1fr)", maxTileHeight: "22vh" }
  // 17+ — 5 columns
  return { columns: 5, rows: Math.ceil(count / 5), templateColumns: "repeat(5, 1fr)", maxTileHeight: "20vh" }
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * VoiceGridLayout — responsive grid container for voice/video participant tiles.
 *
 * Computes the optimal number of columns and tile sizes based on participant
 * count and whether video is active. Replaces the simple `auto-fill` CSS grid
 * with a purpose-built layout that ensures proper video aspect ratios and
 * efficient screen usage.
 *
 * Usage:
 * ```tsx
 * <VoiceGridLayout participantCount={peers.length + 1} hasVideo={hasVideo}>
 *   <ParticipantTile ... /> // self
 *   {peers.map(p => <ParticipantTile key={p.id} ... />)}
 * </VoiceGridLayout>
 * ```
 */
export function VoiceGridLayout({ participantCount, hasVideo, children }: VoiceGridLayoutProps) {
  const isMobile = useMobileLayout()
  const config = useMemo(
    () => computeGridConfig(participantCount, hasVideo, isMobile),
    [participantCount, hasVideo, isMobile]
  )

  return (
    <div
      className="grid gap-3 w-full h-full content-center"
      style={{
        gridTemplateColumns: config.templateColumns,
        ...(config.maxTileHeight ? { "--grid-tile-max-h": config.maxTileHeight } as React.CSSProperties : {}),
      }}
    >
      {children}
    </div>
  )
}

/**
 * VoiceGridTile — wrapper for individual tiles that enforces
 * the grid's max height constraint and proper aspect ratio for video.
 */
export function VoiceGridTile({ children, hasVideo }: { children: ReactNode; hasVideo?: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{
        maxHeight: "var(--grid-tile-max-h, none)",
        aspectRatio: hasVideo ? "16 / 9" : undefined,
      }}
    >
      {children}
    </div>
  )
}
