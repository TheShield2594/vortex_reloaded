"use client"

import { useState } from "react"
import { Sparkles, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react"

interface SummaryData {
  summary: string
  highlights: string[]
  topics: string[]
  messageCount: number
}

interface Props {
  serverId: string
  channelId: string
  lastReadAt?: string | null
}

export function ChannelSummaryCard({ serverId, channelId, lastReadAt }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SummaryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  async function fetchSummary() {
    if (loading) return
    setLoading(true)
    setError(null)
    setOpen(true)

    try {
      const res = await fetch(
        `/api/servers/${serverId}/channels/${channelId}/summarize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ since: lastReadAt }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Summarization failed")
      setData(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={fetchSummary}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all motion-interactive motion-press"
        style={{
          background: "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
          color: "var(--theme-accent)",
          border: "1px solid color-mix(in srgb, var(--theme-accent) 30%, transparent)",
        }}
        title="AI catch-up summary"
        aria-label="Generate AI summary of recent messages"
      >
        <Sparkles className="w-3 h-3" />
        Catch up
      </button>
    )
  }

  return (
    <div
      className="mx-4 mb-3 rounded-xl overflow-hidden"
      style={{
        background: "color-mix(in srgb, var(--theme-accent) 8%, var(--theme-bg-secondary))",
        border: "1px solid color-mix(in srgb, var(--theme-accent) 25%, transparent)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--theme-accent)" }}>
            AI Catch-Up
          </span>
          {data && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                background: "color-mix(in srgb, var(--theme-accent) 15%, transparent)",
                color: "var(--theme-text-muted)",
              }}
            >
              {data.messageCount} messages
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {data && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              style={{ color: "var(--theme-text-muted)" }}
              aria-label={expanded ? "Collapse summary" : "Expand summary"}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); setData(null); setError(null) }}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: "var(--theme-text-muted)" }}
            aria-label="Dismiss summary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="px-4 pb-4 flex items-center gap-2" style={{ color: "var(--theme-text-secondary)" }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--theme-accent)" }} />
          <span className="text-sm">Summarizing recent messages…</span>
        </div>
      )}

      {error && (
        <div className="px-4 pb-4">
          <p className="text-sm" style={{ color: "var(--theme-danger)" }}>{error}</p>
        </div>
      )}

      {data && expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Summary text */}
          <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-primary)" }}>
            {data.summary}
          </p>

          {/* Highlights */}
          {data.highlights.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                Key Points
              </p>
              <ul className="space-y-1">
                {data.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
                      style={{ background: "var(--theme-accent)" }}
                    />
                    <span className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Topics */}
          {data.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.topics.map((topic, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "color-mix(in srgb, var(--theme-accent) 10%, transparent)",
                    color: "var(--theme-accent)",
                    border: "1px solid color-mix(in srgb, var(--theme-accent) 20%, transparent)",
                  }}
                >
                  {topic}
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={fetchSummary}
            className="text-xs transition-colors hover:underline"
            style={{ color: "var(--theme-text-muted)" }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}
