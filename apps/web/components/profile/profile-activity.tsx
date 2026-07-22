"use client"

import { useEffect, useState } from "react"
import {
  ArrowRightCircle,
  FileUp,
  Hash,
  MessageSquare,
  Server,
  SmilePlus,
  Activity,
} from "lucide-react"
import type { UserActivityLogRow } from "@/types/database"

interface ProfileActivityProps {
  userId: string
  /** Pre-fetched activity — if provided, skips the client-side fetch */
  initialActivity?: UserActivityLogRow[]
  /** If true, the feed is hidden due to visibility settings */
  hidden?: boolean
}

const EVENT_ICONS: Record<UserActivityLogRow["event_type"], React.ReactNode> = {
  message_posted:  <MessageSquare className="w-3 h-3" aria-hidden />,
  file_uploaded:   <FileUp className="w-3 h-3" aria-hidden />,
  server_joined:   <Server className="w-3 h-3" aria-hidden />,
  reaction_added:  <SmilePlus className="w-3 h-3" aria-hidden />,
  channel_created: <Hash className="w-3 h-3" aria-hidden />,
}

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(dateString))
}

function ActivityItem({ item }: { item: UserActivityLogRow }) {
  const icon = EVENT_ICONS[item.event_type]

  const inner = (
    <>
      <span
        className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-snug truncate group-hover:[color:var(--theme-accent)] transition-colors" style={{ color: "var(--theme-text-primary)" }}>
          {item.summary}
        </p>
        {item.ref_label && (
          <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
            {item.ref_label}
          </p>
        )}
      </div>
      <span className="flex-shrink-0 text-[11px] tabular-nums" style={{ color: "var(--theme-text-muted)" }}>
        {timeAgo(item.created_at)}
      </span>
    </>
  )

  if (!item.ref_url) {
    return <div className="flex items-start gap-2 py-1">{inner}</div>
  }

  const isExternal = item.ref_url.startsWith("http")
  return (
    <a
      href={item.ref_url}
      {...(isExternal ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className="group flex items-start gap-2 py-1 rounded transition-colors focus:outline-none focus-visible:ring-1"
      style={{ textDecoration: "none" }}
      aria-label={item.summary}
    >
      {inner}
      <ArrowRightCircle
        className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
        style={{ color: "var(--theme-text-muted)" }}
        aria-hidden
      />
    </a>
  )
}

/**
 * Compact recent-activity feed shown on a user's profile.
 * Respects the user's activity_visibility setting — hidden state is
 * communicated gracefully without leaking info.
 */
export function ProfileActivity({ userId, initialActivity, hidden: initialHidden }: ProfileActivityProps) {
  const [activity, setActivity] = useState<UserActivityLogRow[]>(initialActivity ?? [])
  const [hidden, setHidden] = useState(initialHidden ?? false)
  const [loading, setLoading] = useState(initialActivity === undefined && !initialHidden)

  useEffect(() => {
    if (initialActivity !== undefined || initialHidden) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/users/activity?userId=${userId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { activity: UserActivityLogRow[]; hidden?: boolean }) => {
        if (cancelled) return
        setHidden(json.hidden ?? false)
        setActivity(json.activity ?? [])
      })
      .catch(() => { /* silently ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, initialActivity, initialHidden])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-2 py-1">
            <div className="w-5 h-5 rounded-full animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
            <div className="flex-1 h-3 rounded animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
          </div>
        ))}
      </div>
    )
  }

  if (hidden) {
    return (
      <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>
        Activity is private
      </p>
    )
  }

  if (activity.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} aria-hidden />
        <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>
          No recent activity
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y" style={{ borderColor: "var(--theme-bg-tertiary)" }} role="list" aria-label="Recent activity">
      {activity.map((item) => (
        <div key={item.id} role="listitem">
          <ActivityItem item={item} />
        </div>
      ))}
    </div>
  )
}
