"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Activity, AlertTriangle, BarChart3, Loader2, MessageSquare,
  Shield, TrendingDown, TrendingUp, Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HealthMetrics {
  active_members: { current: number; previous: number; trend: number }
  messages_today: number
  messages_this_week: number
  moderation_actions_7d: number
  moderation_actions_trend: number
  top_channels: Array<{ id: string; name: string; message_count: number }>
  unresolved_appeals: number
  permission_warnings: string[]
}

interface Props {
  serverId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TrendBadge({ value }: { value: number }): React.ReactElement {
  if (value === 0) {
    return <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--theme-text-muted)", background: "var(--theme-bg-secondary)" }}>0%</span>
  }
  const isUp = value > 0
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-medium"
      style={{
        color: isUp ? "var(--theme-success, #22c55e)" : "var(--theme-danger, #ef4444)",
        background: isUp
          ? "color-mix(in srgb, var(--theme-success, #22c55e) 12%, transparent)"
          : "color-mix(in srgb, var(--theme-danger, #ef4444) 12%, transparent)",
      }}
    >
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}{value}%
    </span>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  trend,
  iconColor,
}: {
  icon: typeof Users
  label: string
  value: string | number
  trend?: number
  iconColor?: string
}): React.ReactElement {
  return (
    <div
      className="rounded-lg p-4 space-y-2"
      style={{
        background: "var(--theme-bg-secondary)",
        border: "1px solid var(--theme-bg-tertiary)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: iconColor ?? "var(--theme-accent)" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            {label}
          </span>
        </div>
        {trend !== undefined && <TrendBadge value={trend} />}
      </div>
      <p className="text-2xl font-bold" style={{ color: "var(--theme-text-primary)" }}>
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommunityHealthDashboard({ serverId }: Props): React.ReactElement {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/servers/${serverId}/admin/health`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? "Failed to load health metrics")
        return
      }
      setMetrics(await res.json() as HealthMetrics)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--theme-text-muted)" }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm mb-3" style={{ color: "var(--theme-danger, #ef4444)" }}>{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
      </div>
    )
  }

  if (!metrics) return <></>

  return (
    <section className="space-y-6" style={{ color: "var(--theme-text-primary)" }}>
      <header>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5" style={{ color: "var(--theme-accent)" }} />
          Community Health
        </h2>
        <p className="text-sm mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
          Overview of your server&apos;s activity, moderation, and permission health.
        </p>
      </header>

      {/* Key metrics grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={Users}
          label="Active Members"
          value={metrics.active_members.current}
          trend={metrics.active_members.trend}
        />
        <MetricCard
          icon={MessageSquare}
          label="Messages Today"
          value={metrics.messages_today}
          iconColor="var(--theme-text-secondary)"
        />
        <MetricCard
          icon={Shield}
          label="Mod Actions (7d)"
          value={metrics.moderation_actions_7d}
          trend={metrics.moderation_actions_trend}
          iconColor="var(--theme-warning, #f59e0b)"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Unresolved Appeals"
          value={metrics.unresolved_appeals}
          iconColor={metrics.unresolved_appeals > 0 ? "var(--theme-danger, #ef4444)" : "var(--theme-text-muted)"}
        />
      </div>

      {/* Two-column detail area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top channels */}
        <div
          className="rounded-lg p-4 space-y-3"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
              Most Active Channels
            </span>
          </div>
          {metrics.top_channels.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>No channel activity data yet.</p>
          ) : (
            <div className="space-y-2">
              {metrics.top_channels.map((ch, i) => {
                const maxCount = metrics.top_channels[0]?.message_count ?? 1
                const pct = Math.round((ch.message_count / maxCount) * 100)
                return (
                  <div key={ch.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: "var(--theme-text-primary)" }}>
                        <span style={{ color: "var(--theme-text-muted)" }}>{i + 1}.</span> #{ch.name}
                      </span>
                      <span style={{ color: "var(--theme-text-muted)" }}>
                        {ch.message_count.toLocaleString()} msgs
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--theme-bg-tertiary)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: `color-mix(in srgb, var(--theme-accent) ${80 - i * 15}%, var(--theme-bg-tertiary))`,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            Messages this week: {metrics.messages_this_week.toLocaleString()}
          </p>
        </div>

        {/* Permission health */}
        <div
          className="rounded-lg p-4 space-y-3"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: "var(--theme-warning, #f59e0b)" }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
              Permission Health
            </span>
          </div>
          {metrics.permission_warnings.length === 0 ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-success, #22c55e)" }}>
              <Shield className="w-4 h-4" />
              No permission conflicts detected
            </div>
          ) : (
            <div className="space-y-2">
              {metrics.permission_warnings.map((warning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2.5 py-2 rounded text-xs"
                  style={{
                    background: "color-mix(in srgb, var(--theme-warning, #f59e0b) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--theme-warning, #f59e0b) 25%, transparent)",
                    color: "var(--theme-warning, #f59e0b)",
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
