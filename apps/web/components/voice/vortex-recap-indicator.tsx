"use client"

// Always-visible indicator shown in the voice UI while intelligence features are active.
// Shows transcription status, summary pending state, and per-participant consent badges.

import { Mic, FileText, Loader2, AlertCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils/cn"
import type { TranscriptionStatus } from "@/lib/voice/use-vortex-recap"
import type { ParticipantConsentState } from "@/types/vortex-recap"

interface VortexRecapIndicatorProps {
  transcriptionStatus: TranscriptionStatus
  summaryPending: boolean
  participantConsents: Map<string, ParticipantConsentState>
  /** Pass the display name lookup keyed by user_id for readable badge labels. */
  participantNames?: Map<string, string>
  className?: string
}

export function VortexRecapIndicator({
  transcriptionStatus,
  summaryPending,
  participantConsents,
  participantNames,
  className,
}: VortexRecapIndicatorProps) {
  if (transcriptionStatus === "inactive" && !summaryPending && participantConsents.size === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <div className={cn("flex items-center gap-2 flex-wrap", className)}>
        {/* Transcription status dot */}
        {transcriptionStatus !== "inactive" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium select-none"
                style={{
                  background:
                    transcriptionStatus === "active"
                      ? "rgba(35,165,90,0.2)"
                      : "rgba(240,80,80,0.2)",
                  color:
                    transcriptionStatus === "active"
                      ? "var(--theme-success)"
                      : "var(--theme-danger)",
                }}
              >
                {transcriptionStatus === "active" ? (
                  <Mic className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                {transcriptionStatus === "active" ? "Transcribing" : "STT Error"}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {transcriptionStatus === "active"
                ? "Live transcription is active. Your speech is being recorded."
                : "Speech recognition encountered an error."}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Summary pending */}
        {summaryPending && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium select-none"
                style={{
                  background: "rgba(128,132,142,0.18)",
                  color: "var(--theme-text-secondary)",
                }}
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                Summary generating…
              </div>
            </TooltipTrigger>
            <TooltipContent>Post-call summary is being generated.</TooltipContent>
          </Tooltip>
        )}

        {/* Per-participant consent badges */}
        {Array.from(participantConsents.values()).map((consent) => {
          const name = participantNames?.get(consent.userId) ?? consent.userId.slice(0, 6)
          const hasConsent = consent.consentTranscription
          return (
            <Tooltip key={consent.userId}>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs select-none"
                  style={{
                    background: hasConsent ? "rgba(35,165,90,0.12)" : "rgba(128,132,142,0.12)",
                    color: hasConsent ? "var(--theme-success)" : "var(--theme-text-secondary)",
                  }}
                >
                  <FileText className="w-3 h-3" />
                  {name}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {name}: transcription {hasConsent ? "on" : "off"}
                {consent.preferredSubtitleLanguage
                  ? ` · subtitles (${consent.preferredSubtitleLanguage})`
                  : ""}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
