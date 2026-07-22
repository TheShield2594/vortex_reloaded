"use client"

// Transcript viewer panel — shows live interim + final segments in chronological order.
// Rendered inside the voice channel UI when the user has opted in to transcription.

import { useEffect, useRef } from "react"
import { Mic, MicOff } from "lucide-react"
import type { VoiceTranscriptSegmentRow, InterimTranscriptSegment } from "@/types/vortex-recap"

interface VoiceTranscriptViewerProps {
  finalSegments: VoiceTranscriptSegmentRow[]
  interimSegment: InterimTranscriptSegment | null
  /** Map from user_id -> display name for speaker attribution. */
  participantNames?: Map<string, string>
  className?: string
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function SpeakerLabel({ userId, names }: { userId: string | null; names?: Map<string, string> }) {
  const name = userId ? (names?.get(userId) ?? userId.slice(0, 8)) : "Unknown"
  return (
    <span className="font-semibold text-xs" style={{ color: "var(--theme-accent)" }}>
      {name}
    </span>
  )
}

export function VoiceTranscriptViewer({
  finalSegments,
  interimSegment,
  participantNames,
  className,
}: VoiceTranscriptViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [finalSegments, interimSegment])

  const isEmpty = finalSegments.length === 0 && !interimSegment

  return (
    <div
      className={`flex flex-col overflow-y-auto rounded-lg p-3 gap-2 ${className ?? ""}`}
      style={{
        background: "var(--theme-bg-tertiary)",
        maxHeight: "240px",
        minHeight: "80px",
      }}
    >
      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2 py-4"
          style={{ color: "var(--theme-text-faint)" }}
        >
          <MicOff className="w-5 h-5" />
          <span className="text-xs">Transcript will appear here when speaking begins.</span>
        </div>
      ) : (
        <>
          {finalSegments.map((seg) => (
            <div key={seg.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <SpeakerLabel userId={seg.speaker_user_id} names={participantNames} />
                <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}>
                  {formatTimestamp(seg.started_at)}
                </span>
                {seg.confidence !== null && seg.confidence < 0.6 && (
                  <span
                    className="text-xs rounded px-1"
                    style={{ background: "rgba(240,177,50,0.18)", color: "var(--theme-warning)" }}
                  >
                    low confidence
                  </span>
                )}
              </div>
              <p className="text-sm leading-snug" style={{ color: "var(--theme-text-primary)" }}>
                {seg.is_redacted ? "[redacted]" : seg.text}
              </p>
            </div>
          ))}

          {/* Interim segment (in-flight, not persisted) */}
          {interimSegment && (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <SpeakerLabel userId={interimSegment.speakerUserId} names={participantNames} />
                <Mic className="w-3 h-3 animate-pulse" style={{ color: "var(--theme-success)" }} />
              </div>
              <p className="text-sm leading-snug italic" style={{ color: "var(--theme-text-secondary)" }}>
                {interimSegment.text}
              </p>
            </div>
          )}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
