"use client"

import { useCallback, useEffect, useState } from "react"
import { Eye, Loader2, Shield, ShieldOff, Users, Clock, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleVisibility {
  id: string
  name: string
  color: string
  can_view: boolean
}

interface RecentAction {
  id: string
  action: string
  actor_name: string
  created_at: string
  reason: string | null
}

interface TransparencyData {
  channel_name: string
  visible_to: RoleVisibility[]
  hidden_from: RoleVisibility[]
  recent_actions: RecentAction[]
}

interface Props {
  serverId: string
  channelId: string
  /** If true, the panel is rendered inline (no popover wrapper needed). */
  inline?: boolean
  onOpenSimulator?: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TransparencyPanel({ serverId, channelId, inline, onOpenSimulator }: Props): React.ReactElement {
  const [data, setData] = useState<TransparencyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/servers/${serverId}/channels/${channelId}/transparency`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? "Failed to load transparency data")
        return
      }
      setData(await res.json() as TransparencyData)
    } catch (err: unknown) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[TransparencyPanel] Failed to load data", { serverId, channelId, error: err })
      }
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [serverId, channelId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className={`${inline ? "" : "w-80"} p-4 flex items-center justify-center`}>
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--theme-text-muted)" }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${inline ? "" : "w-80"} p-4`}>
        <p className="text-sm" style={{ color: "var(--theme-danger, #ef4444)" }}>{error}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>Retry</Button>
      </div>
    )
  }

  if (!data) return <></>

  return (
    <div className={`${inline ? "" : "w-80"} space-y-3`} style={{ color: "var(--theme-text-primary)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <Eye className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
        <span className="text-sm font-semibold">
          #{data.channel_name} &middot; Transparency
        </span>
      </div>

      {/* Visible to */}
      <div className="px-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Users className="w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            Visible to
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {data.visible_to.map((role) => (
            <span
              key={role.id}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs border"
              style={{
                color: role.color || "var(--theme-text-secondary)",
                borderColor: `color-mix(in srgb, ${role.color || "var(--theme-text-muted)"} 30%, transparent)`,
                background: `color-mix(in srgb, ${role.color || "var(--theme-text-muted)"} 10%, transparent)`,
              }}
            >
              @{role.name}
            </span>
          ))}
          {data.visible_to.length === 0 && (
            <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>No roles</span>
          )}
        </div>
      </div>

      {/* Hidden from */}
      {data.hidden_from.length > 0 && (
        <div className="px-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ShieldOff className="w-3.5 h-3.5" style={{ color: "var(--theme-danger, #ef4444)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
              Hidden from
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {data.hidden_from.map((role) => (
              <span
                key={role.id}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs border"
                style={{
                  color: "var(--theme-danger, #ef4444)",
                  borderColor: "color-mix(in srgb, var(--theme-danger, #ef4444) 30%, transparent)",
                  background: "color-mix(in srgb, var(--theme-danger, #ef4444) 10%, transparent)",
                }}
              >
                @{role.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Separator */}
      <div className="mx-3 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />

      {/* Recent Actions */}
      <div className="px-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Clock className="w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            Recent Actions (7 days)
          </span>
        </div>
        {data.recent_actions.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            No moderation actions in this channel recently.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {data.recent_actions.map((action) => (
              <div
                key={action.id}
                className="flex items-start justify-between gap-2 px-2 py-1.5 rounded text-xs"
                style={{ background: "var(--theme-bg-secondary)" }}
              >
                <div className="min-w-0">
                  <p style={{ color: "var(--theme-text-primary)" }}>
                    <span className="font-medium" style={{ color: "var(--theme-accent)" }}>
                      @{action.actor_name}
                    </span>{" "}
                    {action.action}
                  </p>
                  {action.reason && (
                    <p className="truncate" style={{ color: "var(--theme-text-muted)" }}>
                      {action.reason}
                    </p>
                  )}
                </div>
                <span className="shrink-0" style={{ color: "var(--theme-text-muted)" }}>
                  {formatTimeAgo(action.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="mx-3 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />

      {/* Permission Sandbox link */}
      <div className="px-3 pb-3">
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-center gap-1.5 text-xs"
          disabled={!onOpenSimulator}
          onClick={onOpenSimulator}
        >
          <Shield className="w-3.5 h-3.5" />
          Open Permission Sandbox
          <ExternalLink className="w-3 h-3 ml-auto" style={{ color: "var(--theme-text-muted)" }} />
        </Button>
      </div>
    </div>
  )
}
