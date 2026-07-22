"use client"

// Vortex Recap — branded post-call card shown inline in the text channel
// after a voice session ends. Displays duration, participant count, and
// AI-generated summary (highlights, decisions, action items).

import { useState, useEffect, useCallback } from "react"
import { Mic, Clock, Users, FileText, Loader2, ChevronDown, ChevronUp, Copy, Check } from "lucide-react"
import type { VoiceCallSummaryRow, VoiceSummaryStatus } from "@/types/vortex-recap"

interface VoiceRecapCardProps {
  sessionId: string
  channelName: string
  durationSeconds: number
  className?: string
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins} min`
  return `${totalSeconds}s`
}

export function VoiceRecapCard({
  sessionId,
  channelName,
  durationSeconds,
  className,
}: VoiceRecapCardProps): React.ReactElement | null {
  const [summary, setSummary] = useState<VoiceCallSummaryRow | null>(null)
  const [status, setStatus] = useState<VoiceSummaryStatus>("pending")
  const [participantCount, setParticipantCount] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const fetchSummary = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/voice/sessions/${sessionId}/summary`)
      if (!res.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.error(`[VoiceRecapCard] Failed to fetch summary for session ${sessionId}: HTTP ${res.status}`)
        }
        setStatus("failed")
        return
      }

      const data = (await res.json()) as {
        summary: VoiceCallSummaryRow | null
        status: VoiceSummaryStatus
        participantCount?: number
      }
      setStatus(data.status)
      if (data.participantCount != null) {
        setParticipantCount(data.participantCount)
      }
      if (data.status === "ready" && data.summary) {
        setSummary(data.summary)
      }
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[VoiceRecapCard] Error fetching summary for session ${sessionId}:`, err instanceof Error ? err.message : "unknown error")
      }
      setStatus("failed")
    }
  }, [sessionId])

  useEffect(() => {
    if (status !== "pending") return

    fetchSummary()
    const interval = setInterval(fetchSummary, 5000)
    return () => clearInterval(interval)
  }, [status, fetchSummary])

  async function handleCopySummary(): Promise<void> {
    if (!summary) return
    const text = [
      `Vortex Recap — ${channelName} — ${formatDuration(durationSeconds)}`,
      "",
      "Highlights:",
      summary.highlights_md,
      "",
      "Decisions:",
      summary.decisions_md,
      "",
      "Action Items:",
      summary.action_items_md,
    ].join("\n")

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard not available
    }
  }

  const transcriptLink = (
    <a
      href={`/api/voice/sessions/${sessionId}/transcript`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-white/10"
      style={{ color: "var(--theme-accent)" }}
    >
      <FileText className="w-3 h-3" />
      View Full Transcript
    </a>
  )

  return (
    <div
      className={`rounded-xl overflow-hidden my-2 mx-4 ${className ?? ""}`}
      style={{
        background: "var(--theme-bg-secondary)",
        border: "1px solid color-mix(in srgb, var(--theme-accent) 20%, transparent)",
      }}
    >
      {/* Header bar */}
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/5"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse voice recap" : "Expand voice recap"}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "color-mix(in srgb, var(--theme-accent) 15%, transparent)" }}
          >
            <Mic className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
          </div>
          <div className="text-left">
            <span className="text-sm font-semibold" style={{ color: "var(--theme-text-bright)" }}>
              Vortex Recap
            </span>
            <span className="text-xs ml-2" style={{ color: "var(--theme-text-muted)" }}>
              {channelName}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--theme-text-secondary)" }}>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDuration(durationSeconds)}
            </span>
            {participantCount != null && participantCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" /> {participantCount}
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "var(--theme-text-secondary)" }} />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "var(--theme-text-secondary)" }} />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {status === "pending" && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating recap…
            </div>
          )}

          {status === "ready" && summary && (
            <>
              <RecapSection title="Highlights" content={summary.highlights_md} />
              <RecapSection title="Decisions" content={summary.decisions_md} />
              <RecapSection title="Action Items" content={summary.action_items_md} />

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs" style={{ color: "var(--theme-text-faint)" }}>
                  Generated by {summary.model} &middot; {new Date(summary.generated_at).toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  {transcriptLink}
                  <button
                    onClick={handleCopySummary}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-white/10"
                    style={{ color: "var(--theme-text-secondary)" }}
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy Summary"}
                  </button>
                </div>
              </div>
            </>
          )}

          {(status === "failed" || status === "skipped") && (
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                {status === "skipped"
                  ? "Not enough conversation to generate a recap."
                  : "Recap generation failed. The transcript is still available."}
              </p>
              {transcriptLink}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecapSection({ title, content }: { title: string; content: string }): React.ReactElement | null {
  if (!content.trim()) return null
  return (
    <div>
      <h4
        className="text-xs font-semibold uppercase tracking-wide mb-1"
        style={{ color: "var(--theme-accent)" }}
      >
        {title}
      </h4>
      <p
        className="text-sm whitespace-pre-wrap leading-relaxed"
        style={{ color: "var(--theme-text-primary)" }}
      >
        {content}
      </p>
    </div>
  )
}
