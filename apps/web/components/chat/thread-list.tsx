"use client"

import { useEffect, useState, useCallback } from "react"
import { MessageSquare, ChevronDown, ChevronRight, Archive, Lock, Clock } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import type { ThreadRow } from "@/types/database"
import { useRealtimeThreads } from "@/hooks/use-realtime-threads"
import { cn } from "@/lib/utils/cn"
import { Skeleton } from "@/components/ui/skeleton"
import { BrandedEmptyState } from "@/components/ui/branded-empty-state"
import { createClientSupabaseClient } from "@/lib/supabase/client"

// Threads returned by the API include the computed is_unread field
type ThreadRowWithUnread = ThreadRow & { is_unread?: boolean }

interface Props {
  channelId: string
  activeThreadId: string | null
  filter: "all" | "active" | "archived"
  onSelectThread: (thread: ThreadRow) => void
}

/** Sidebar list of threads for a channel with active/archived filtering and real-time insert/update via Supabase. */
export function ThreadList({ channelId, activeThreadId, filter, onSelectThread }: Props) {
  const [threads, setThreads] = useState<ThreadRowWithUnread[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [archivedThreads, setArchivedThreads] = useState<ThreadRowWithUnread[]>([])
  const [expanded, setExpanded] = useState(true)
  const [loadingArchived, setLoadingArchived] = useState(false)
  const shouldShowArchived = showArchived || filter === "archived"

  // Load active threads
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/threads?channelId=${channelId}&archived=false`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data)) {
          setThreads(data)
        }
      })
      .catch((err) => { if (err.name !== "AbortError") console.error("Failed to load threads", err) })
    return () => controller.abort()
  }, [channelId])

  // Load archived threads on demand
  useEffect(() => {
    if (!shouldShowArchived) return
    const controller = new AbortController()
    setLoadingArchived(true)
    fetch(`/api/threads?channelId=${channelId}&archived=true`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted) {
          if (Array.isArray(data)) setArchivedThreads(data)
          setLoadingArchived(false)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setLoadingArchived(false)
      })
    return () => controller.abort()
  }, [shouldShowArchived, channelId, filter])

  // Realtime updates — new threads start as unread (they have fresh activity)
  useRealtimeThreads(
    channelId,
    (newThread) => {
      if (!newThread.archived) {
        setThreads((prev) => {
          if (prev.some((t) => t.id === newThread.id)) return prev
          return [{ ...newThread, is_unread: true }, ...prev]
        })
      }
    },
    (updatedThread) => {
      const markUnread = (t: ThreadRowWithUnread) =>
        t.id === updatedThread.id ? { ...t, ...updatedThread, is_unread: true } : t

      if (updatedThread.archived) {
        setThreads((prev) => prev.filter((t) => t.id !== updatedThread.id))
        setArchivedThreads((prev) => {
          const without = prev.filter((t) => t.id !== updatedThread.id)
          return [{ ...updatedThread, is_unread: true }, ...without]
        })
      } else {
        setThreads((prev) => {
          const idx = prev.findIndex((t) => t.id === updatedThread.id)
          if (idx >= 0) return prev.map(markUnread)
          return [{ ...updatedThread, is_unread: true }, ...prev]
        })
        setArchivedThreads((prev) => prev.filter((t) => t.id !== updatedThread.id))
      }
    }
  )

  const handleSelectThread = useCallback((thread: ThreadRowWithUnread) => {
    // Optimistically clear unread indicator
    setThreads((prev) => prev.map((t) => t.id === thread.id ? { ...t, is_unread: false } : t))
    setArchivedThreads((prev) => prev.map((t) => t.id === thread.id ? { ...t, is_unread: false } : t))

    // Persist read state via RPC (fire-and-forget)
    const supabase = createClientSupabaseClient()
    void Promise.resolve(supabase.rpc("mark_thread_read", { p_thread_id: thread.id }))

    onSelectThread(thread)
  }, [onSelectThread])

  const visibleThreads = filter === "archived" ? [] : threads
  const visibleArchivedThreads = filter === "active" ? [] : archivedThreads
  const shouldAllowArchivedToggle = filter !== "active"
  const unreadCount = threads.filter((t) => t.is_unread && t.id !== activeThreadId).length

  return (
    <div className="border-t mx-0" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
      {/* Section header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 w-full px-4 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-white/5 transition-colors"
        style={{ color: "var(--theme-text-muted)" }}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} channel threads`}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <MessageSquare className="w-3 h-3" />
        Channel threads
        <span
          className="ml-auto rounded-full px-1.5 py-0.5 text-xs"
          style={{ background: "var(--theme-text-faint)", color: "var(--theme-text-normal)" }}
        >
          {threads.length}
        </span>
        {unreadCount > 0 && (
          <span
            className="rounded-full px-1.5 py-0.5 text-xs font-bold"
            style={{ background: "var(--theme-accent)", color: "var(--theme-bg-primary)" }}
            aria-label={`${unreadCount} unread thread${unreadCount > 1 ? "s" : ""}`}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {expanded && (
        <>
          <div className="px-4 pb-1 text-[11px]" style={{ color: "var(--theme-text-muted)" }}>
            Each thread belongs to this channel and re-opens in the thread panel.
          </div>
          {visibleThreads.length === 0 && !shouldShowArchived ? (
            <div className="px-4 py-4">
              <BrandedEmptyState
                icon={MessageSquare}
                title="No threads yet"
                description="Start a thread from any message to keep side conversations organized."
                hint="Tip: Hover a message and click the thread icon."
              />
            </div>
          ) : (
            visibleThreads.map((thread) => (
              <ThreadListItem
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeThreadId}
                isUnread={!!thread.is_unread && thread.id !== activeThreadId}
                onClick={() => handleSelectThread(thread)}
              />
            ))
          )}

          {shouldAllowArchivedToggle && (
            <button
              type="button"
              onClick={() => setShowArchived((s) => !s)}
              className="flex items-center gap-2 w-full px-4 py-1.5 text-xs hover:bg-white/5 transition-colors"
              style={{ color: "var(--theme-text-muted)" }}
            >
              <Archive className="w-3 h-3" />
              {showArchived ? "Hide archived" : "Show archived threads"}
            </button>
          )}

          {shouldShowArchived && (
            <>
              {loadingArchived ? (
                <div className="space-y-2 px-4 py-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-11/12" />
                </div>
              ) : (
                visibleArchivedThreads.map((thread) => (
                  <ThreadListItem
                    key={thread.id}
                    thread={thread}
                    isActive={thread.id === activeThreadId}
                    isUnread={!!thread.is_unread && thread.id !== activeThreadId}
                    onClick={() => handleSelectThread(thread)}
                  />
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function formatDuration(minutes: number): string {
  if (minutes === 60) return "1h"
  if (minutes === 1440) return "24h"
  if (minutes === 4320) return "3d"
  if (minutes === 10080) return "1w"
  return `${minutes}m`
}

function ThreadListItem({
  thread,
  isActive,
  isUnread,
  onClick,
}: {
  thread: ThreadRow
  isActive: boolean
  isUnread: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-4 py-1.5 text-sm text-left transition-colors rounded-sm mx-1 focus-ring",
        isActive ? "bg-white/10" : "hover:bg-white/5"
      )}
      style={{ maxWidth: "calc(100% - 8px)" }}
      aria-current={isActive ? "true" : undefined}
    >
      <MessageSquare
        className="w-3.5 h-3.5 flex-shrink-0"
        style={{ color: isUnread ? "var(--theme-accent)" : "var(--theme-text-muted)" }}
      />
      <span
        className={cn("truncate flex-1", isUnread && "font-semibold")}
        style={{ color: isActive ? "var(--theme-text-primary)" : isUnread ? "var(--theme-text-bright)" : "var(--theme-text-secondary)" }}
      >
        {thread.name}
      </span>
      {thread.locked && <Lock className="w-3 h-3 flex-shrink-0" style={{ color: "var(--theme-danger)" }} />}
      {thread.archived && <Archive className="w-3 h-3 flex-shrink-0" style={{ color: "var(--theme-warning)" }} />}
      {!thread.archived && !thread.locked && thread.auto_archive_duration && (
        <span
          className="text-[10px] flex-shrink-0"
          style={{ color: "var(--theme-text-faint)" }}
          title={`Auto-archives after ${formatDuration(thread.auto_archive_duration)} of inactivity`}
        >
          <Clock className="w-3 h-3 inline" />
        </span>
      )}
      {isUnread && !isActive && (
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: "var(--theme-accent)" }}
          aria-label="Unread activity"
        />
      )}
      {thread.message_count > 0 && (
        <span
          className="text-xs flex-shrink-0"
          style={{ color: "var(--theme-text-faint)" }}
          aria-label={`${thread.message_count} ${thread.message_count === 1 ? "reply" : "replies"}`}
          title={`${thread.message_count} ${thread.message_count === 1 ? "reply" : "replies"}`}
        >
          {thread.message_count}
        </span>
      )}
      <span
        className="text-xs flex-shrink-0 ml-auto"
        style={{ color: "var(--theme-text-faint)" }}
        title={format(new Date(thread.updated_at), "PPpp")}
      >
        {formatDistanceToNow(new Date(thread.updated_at), { addSuffix: false })}
      </span>
    </button>
  )
}
