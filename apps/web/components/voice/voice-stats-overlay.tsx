"use client"

import { memo, useState } from "react"
import { BarChart3, X } from "lucide-react"
import type { NetworkQualityStats, NetworkQualityTier } from "@/lib/webrtc/use-voice"

// ── Constants ────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<NetworkQualityTier, string> = {
  good: "var(--theme-success)",
  degraded: "var(--theme-warning)",
  poor: "var(--theme-danger)",
}

const TIER_LABELS: Record<NetworkQualityTier, string> = {
  good: "Good",
  degraded: "Unstable",
  poor: "Poor",
}

// ── Stat row helper ──────────────────────────────────────────────────────────

function StatRow({ label, value, unit, warn }: { label: string; value: string | number; unit?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{label}</span>
      <span
        className="text-xs font-mono tabular-nums"
        style={{ color: warn ? "var(--theme-warning)" : "var(--theme-text-primary)" }}
      >
        {value}{unit && <span style={{ color: "var(--theme-text-faint)" }}> {unit}</span>}
      </span>
    </div>
  )
}

// ── Mini bar chart for stat history ──────────────────────────────────────────

function MiniBarChart({ values, maxVal, color }: { values: number[]; maxVal: number; color: string }) {
  const barCount = values.length
  if (barCount === 0) return null
  return (
    <div className="flex items-end gap-[1px] h-6" aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className="rounded-t-[1px] transition-all duration-300"
          style={{
            width: `${Math.max(100 / barCount - 1, 2)}%`,
            height: `${Math.max((v / Math.max(maxVal, 1)) * 100, 4)}%`,
            background: color,
            opacity: 0.4 + (i / barCount) * 0.6,
          }}
        />
      ))}
    </div>
  )
}

// ── VoiceStatsOverlay ────────────────────────────────────────────────────────

interface VoiceStatsOverlayProps {
  /** Current network quality stats (null if unavailable). */
  quality: NetworkQualityStats | null
  /** Historical RTT values for the mini chart (most recent last). */
  rttHistory?: number[]
  /** Historical packet loss values for the mini chart (most recent last). */
  lossHistory?: number[]
  /** Number of connected peers. */
  peerCount: number
  /** Codec in use (e.g. "opus"). */
  codec?: string
  /** Whether the overlay is open. */
  open: boolean
  /** Toggle handler. */
  onToggle: () => void
}

/**
 * VoiceStatsOverlay — advanced network stats panel that can be toggled
 * from the voice channel header. Shows real-time bitrate, jitter, packet
 * loss, RTT, and mini sparkline charts for trend visualization.
 */
export const VoiceStatsOverlay = memo(function VoiceStatsOverlay({
  quality,
  rttHistory = [],
  lossHistory = [],
  peerCount,
  codec,
  open,
  onToggle,
}: VoiceStatsOverlayProps) {
  if (!open) return null

  const tier = quality?.tier ?? "good"
  const tierColor = TIER_COLORS[tier]
  const tierLabel = TIER_LABELS[tier]

  return (
    <div
      className="absolute top-full right-0 mt-2 w-72 rounded-xl shadow-2xl z-50 overflow-hidden"
      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: tierColor }} />
          <span className="text-sm font-semibold text-white">Connection Stats</span>
        </div>
        <button
          onClick={onToggle}
          className="w-6 h-6 rounded flex items-center justify-center hover:opacity-80"
          style={{ color: "var(--theme-text-muted)" }}
          aria-label="Close stats overlay"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Overall quality badge */}
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: `color-mix(in srgb, ${tierColor} 20%, transparent)`,
              color: tierColor,
            }}
          >
            {tierLabel}
          </span>
          <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}>
            {peerCount} peer{peerCount !== 1 ? "s" : ""} connected
          </span>
        </div>

        {quality ? (
          <>
            {/* Detailed stats */}
            <div className="divide-y" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
              <StatRow label="Round-trip time" value={quality.rttMs} unit="ms" warn={quality.rttMs > 150} />
              <StatRow label="Packet loss" value={quality.packetLossPercent.toFixed(2)} unit="%" warn={quality.packetLossPercent > 2} />
              <StatRow label="Jitter" value={quality.jitterMs.toFixed(1)} unit="ms" warn={quality.jitterMs > 30} />
              {quality.availableBitrateKbps !== null && (
                <StatRow label="Bitrate" value={quality.availableBitrateKbps} unit="kbps" />
              )}
              {codec && <StatRow label="Codec" value={codec} />}
            </div>

            {/* RTT history chart */}
            {rttHistory.length > 1 && (
              <div>
                <p className="text-[10px] mb-1" style={{ color: "var(--theme-text-faint)" }}>RTT trend</p>
                <MiniBarChart values={rttHistory} maxVal={Math.max(...rttHistory, 100)} color={tierColor} />
              </div>
            )}

            {/* Loss history chart */}
            {lossHistory.length > 1 && (
              <div>
                <p className="text-[10px] mb-1" style={{ color: "var(--theme-text-faint)" }}>Packet loss trend</p>
                <MiniBarChart values={lossHistory} maxVal={Math.max(...lossHistory, 5)} color="var(--theme-danger)" />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs py-2" style={{ color: "var(--theme-text-muted)" }}>
            Collecting network statistics...
          </p>
        )}
      </div>
    </div>
  )
})

// ── Toggle button for the header ─────────────────────────────────────────────

export function VoiceStatsToggle({ quality, onClick }: { quality: NetworkQualityStats | null; onClick: () => void }) {
  const tier = quality?.tier ?? "good"
  const color = TIER_COLORS[tier]
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:opacity-80 transition-opacity"
      style={{ color }}
      title="Toggle connection stats"
      aria-label="Toggle connection stats"
    >
      <BarChart3 className="w-3.5 h-3.5" />
    </button>
  )
}
