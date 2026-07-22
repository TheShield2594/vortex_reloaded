"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X, Hash, Lock, Archive, ArchiveRestore, Users, Clock } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { sendReactionMutation } from "@/lib/reactions-client"
import type { ThreadRow, ThreadWithDetails, MessageWithAuthor, MessageRow } from "@/types/database"
import { MessageItem } from "@/components/chat/message-item"
import { MessageInput } from "@/components/chat/message-input"
import { useRealtimeThreadMessages } from "@/hooks/use-realtime-threads"
import { cn } from "@/lib/utils/cn"
import { useAppearanceStore } from "@/lib/stores/appearance-store"
import { format, isToday, isYesterday } from "date-fns"

/** Format a date for the day separator. */
function formatDaySeparator(date: Date): string {
  if (isToday(date)) return "Today"
  if (isYesterday(date)) return "Yesterday"
  return format(date, "MMMM d, yyyy")
}
import { useToast } from "@/components/ui/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { AUTO_ARCHIVE_OPTIONS, DEFAULT_AUTO_ARCHIVE_DURATION } from "@vortex/shared"

interface Props {
  thread: ThreadRow
  currentUserId: string
  onClose: () => void
  onThreadUpdate: (thread: ThreadRow) => void
  focusMessageId?: string | null
}

function formatAutoArchiveDuration(minutes: number): string {
  return AUTO_ARCHIVE_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes}m`
}

/** Slide-out panel displaying a thread's messages with real-time updates, archive/lock controls, and member management. */
export function ThreadPanel({ thread, currentUserId, onClose, onThreadUpdate, focusMessageId }: Props) {
  const messageGrouping = useAppearanceStore((s) => s.messageGrouping)
  const [messages, setMessages] = useState<MessageWithAuthor[]>([])
  const [replyTo, setReplyTo] = useState<MessageWithAuthor | null>(null)
  const [draft, setDraftContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [isMember, setIsMember] = useState(false)
  const [threadNotifyMode, setThreadNotifyMode] = useState<"all" | "mentions" | "muted">("all")
  const [threadNotifyInherited, setThreadNotifyInherited] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const handledFocusRef = useRef<string | null>(null)
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const { toast } = useToast()

  // Load messages
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/threads/${thread.id}/messages`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted) {
          if (Array.isArray(data)) setMessages(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [thread.id])

  // Check membership
  useEffect(() => {
    supabase
      .from("thread_members")
      .select("user_id")
      .eq("thread_id", thread.id)
      .eq("user_id", currentUserId)
      .single()
      .then(({ data }) => setIsMember(!!data))
  }, [thread.id, currentUserId])

  useEffect(() => {
    const controller = new AbortController()

    fetch(`/api/notification-settings?threadId=${thread.id}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data || controller.signal.aborted) return
        if (data.mode && ["all", "mentions", "muted"].includes(data.mode)) {
          setThreadNotifyMode(data.mode)
        }
        setThreadNotifyInherited(Boolean(data.inherited))
      })
      .catch((error) => {
        if ((error as { name?: string } | null)?.name === "AbortError") return
      })

    return () => { controller.abort() }
  }, [thread.id])

  // Scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  // Initial scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [loading])

  useEffect(() => {
    if (!focusMessageId) {
      handledFocusRef.current = null
      return
    }
    if (handledFocusRef.current === focusMessageId || loading) return

    const target = document.getElementById(`message-${focusMessageId}`)
    if (!target) return

    target.scrollIntoView({ block: "center", behavior: "smooth" })
    target.classList.add("ring-2", "ring-indigo-400/70", "rounded-md")
    handledFocusRef.current = focusMessageId

    const timer = window.setTimeout(() => {
      target.classList.remove("ring-2", "ring-indigo-400/70", "rounded-md")
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [focusMessageId, loading])

  useEffect(() => {
    setDraftContent("")
    handledFocusRef.current = null
  }, [thread.id])

  // Realtime
  useRealtimeThreadMessages(
    thread.id,
    (newMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMessage.id)) return prev
        return [...prev, newMessage]
      })
    },
    (updatedMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m))
      )
    },
    (reaction) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== reaction.message_id) return m
          if (m.reactions.some((r) => r.emoji === reaction.emoji && r.user_id === reaction.user_id)) return m
          return { ...m, reactions: [...m.reactions, reaction] }
        })
      )
    },
    (reaction) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== reaction.message_id) return m
          return { ...m, reactions: m.reactions.filter((r) => !(r.emoji === reaction.emoji && r.user_id === reaction.user_id)) }
        })
      )
    }
  )

  async function handleJoin() {
    const res = await fetch(`/api/threads/${thread.id}/members`, { method: "POST" })
    if (res.ok) {
      setIsMember(true)
      toast({ title: "Joined thread" })
    }
  }

  async function handleLeave() {
    const res = await fetch(`/api/threads/${thread.id}/members`, { method: "DELETE" })
    if (res.ok) {
      setIsMember(false)
      toast({ title: "Left thread" })
    }
  }

  async function handleArchive() {
    const res = await fetch(`/api/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !thread.archived }),
    })
    if (res.ok) {
      const updated = await res.json()
      onThreadUpdate(updated)
      toast({ title: thread.archived ? "Thread unarchived" : "Thread archived" })
    }
  }

  async function handleLock() {
    const res = await fetch(`/api/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: !thread.locked }),
    })
    if (res.ok) {
      const updated = await res.json()
      onThreadUpdate(updated)
      toast({ title: thread.locked ? "Thread unlocked" : "Thread locked" })
    }
  }

  async function handleAutoArchiveDuration(duration: number) {
    try {
      const res = await fetch(`/api/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_archive_duration: duration }),
      })
      if (res.ok) {
        const updated = await res.json()
        onThreadUpdate(updated)
        toast({ title: `Auto-archive set to ${formatAutoArchiveDuration(duration)}` })
      } else {
        const data = await res.json().catch(() => null)
        toast({ variant: "destructive", title: "Failed to update auto-archive", description: data?.error ?? "Unknown error" })
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to update auto-archive", description: "Network error" })
    }
  }

  async function handleThreadNotifyMode(nextMode: "all" | "mentions" | "muted") {
    const previousMode = threadNotifyMode
    const previousInherited = threadNotifyInherited
    setThreadNotifyMode(nextMode)
    setThreadNotifyInherited(false)

    try {
      const res = await fetch("/api/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, mode: nextMode }),
      })

      if (!res.ok) {
        throw new Error("Failed to update thread notifications")
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("failed to update thread notifications", { threadId: thread.id, error })
      }
      setThreadNotifyMode(previousMode)
      setThreadNotifyInherited(previousInherited)
      toast({ variant: "destructive", title: "Failed to update thread notifications" })
    }
  }

  async function resetThreadNotifyInheritance() {
    const previousMode = threadNotifyMode
    const previousInherited = threadNotifyInherited
    setThreadNotifyInherited(true)

    try {
      const res = await fetch(`/api/notification-settings?threadId=${thread.id}`, { method: "DELETE" })
      if (!res.ok) {
        throw new Error("Failed to reset thread notifications")
      }

      const refreshedRes = await fetch(`/api/notification-settings?threadId=${thread.id}`)
      if (!refreshedRes.ok) {
        throw new Error("Failed to refresh thread notifications")
      }

      const refreshed = await refreshedRes.json()
      if (refreshed?.mode && ["all", "mentions", "muted"].includes(refreshed.mode)) {
        setThreadNotifyMode(refreshed.mode)
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("failed to reset thread notifications", { threadId: thread.id, error })
      }
      setThreadNotifyMode(previousMode)
      setThreadNotifyInherited(previousInherited)
      toast({ variant: "destructive", title: "Failed to reset thread notifications" })
    }
  }

  async function handleSendMessage(content: string, attachmentFiles?: File[]) {
    if (!content.trim() && (!attachmentFiles || attachmentFiles.length === 0)) return

    const attachments: { url: string; filename: string; size: number; content_type: string }[] = []

    if (attachmentFiles?.length) {
      for (const file of attachmentFiles) {
        const path = `threads/${thread.id}/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from("attachments").upload(path, file)
        if (!error) {
          const { data: signed } = await supabase.storage
            .from("attachments")
            .createSignedUrl(path, 3600 * 24 * 7)
          if (signed) {
            attachments.push({
              url: signed.signedUrl,
              filename: file.name,
              size: file.size,
              content_type: file.type,
            })
          }
        }
      }
    }

    const res = await fetch(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.trim() || undefined,
        replyToId: replyTo?.id,
        attachments,
      }),
    })

    if (!res.ok) {
      const { error } = await res.json()
      toast({ variant: "destructive", title: "Failed to send", description: error })
      return
    }

    const message = await res.json()

    // If the thread was auto-unarchived by this message, update parent state
    if (message._thread_unarchived) {
      onThreadUpdate({ ...thread, archived: false, archived_at: null } as ThreadRow)
      toast({ title: "Thread unarchived by your message" })
    }

    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev
      return [...prev, message]
    })
    setReplyTo(null)
    setDraftContent("")

    if (!isMember) setIsMember(true)
  }

  // Discord-style: locked threads block all input; archived (non-locked) threads
  // can still receive messages, which auto-unarchives them.
  const canSend = !thread.locked

  return (
    <div
      className="flex flex-col w-80 flex-shrink-0 border-l thread-panel-container"
      style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--theme-bg-tertiary)" }}
      >
        <Hash className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
        <span className="font-semibold text-white text-sm truncate flex-1">{thread.name}</span>
        <div className="flex items-center gap-1 ml-auto">
          {thread.owner_id === currentUserId && (
            <>
              <button
                onClick={handleArchive}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                style={{ color: "var(--theme-text-muted)" }}
                title={thread.archived ? "Unarchive thread" : "Archive thread"}
                aria-label={thread.archived ? "Unarchive thread" : "Archive thread"}
              >
                {thread.archived ? (
                  <ArchiveRestore className="w-4 h-4" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={handleLock}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                style={{ color: thread.locked ? "var(--theme-danger)" : "var(--theme-text-muted)" }}
                title={thread.locked ? "Unlock thread" : "Lock thread"}
                aria-label={thread.locked ? "Unlock thread" : "Lock thread"}
              >
                <Lock className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={isMember ? handleLeave : handleJoin}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            style={{ color: isMember ? "var(--theme-accent)" : "var(--theme-text-muted)" }}
            title={isMember ? "Leave thread" : "Join thread"}
            aria-label={isMember ? "Leave thread" : "Join thread"}
          >
            <Users className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            style={{ color: "var(--theme-text-muted)" }}
            title="Close thread"
            aria-label="Close thread"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--theme-bg-secondary)" }}>
        {thread.archived && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--theme-warning)", color: "var(--theme-bg-tertiary)" }}
            >
              <Archive className="w-3 h-3" /> Archived
            </span>
          )}
          {thread.locked && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--theme-danger)", color: "var(--theme-text-bright)" }}
            >
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
          {(() => {
            const duration = thread.auto_archive_duration ?? DEFAULT_AUTO_ARCHIVE_DURATION
            return thread.owner_id === currentUserId ? (
              <span className="flex items-center gap-1 text-xs">
                <Clock className="w-3 h-3" style={{ color: "var(--theme-text-muted)" }} />
                <select
                  value={duration}
                  onChange={(e) => handleAutoArchiveDuration(Number(e.target.value))}
                  className="text-xs rounded px-1.5 py-0.5"
                  style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-text-faint)" }}
                  aria-label="Auto-archive duration"
                >
                  {AUTO_ARCHIVE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      Archive: {opt.label}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-xs"
                style={{ color: "var(--theme-text-muted)" }}
                title={`Auto-archives after ${formatAutoArchiveDuration(duration)} of inactivity`}
              >
                <Clock className="w-3 h-3" /> {formatAutoArchiveDuration(duration)}
              </span>
            )
          })()}
          {isMember && (
            <>
              <select
                value={threadNotifyMode}
                onChange={(event) => handleThreadNotifyMode(event.target.value as "all" | "mentions" | "muted")}
                className="ml-auto text-xs rounded px-2 py-1"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-text-faint)" }}
                aria-label="Thread notification mode"
              >
                <option value="all">Thread: All</option>
                <option value="mentions">Thread: Mentions</option>
                <option value="muted">Thread: Muted</option>
              </select>
              {!threadNotifyInherited && (
                <button
                  type="button"
                  onClick={resetThreadNotifyInheritance}
                  className="text-[11px] px-2 py-1 rounded hover:bg-white/10"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  Reset
                </button>
              )}
            </>
          )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-4 px-3 py-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="px-4 py-6 text-sm text-center" style={{ color: "var(--theme-text-muted)" }}>
            No messages yet. Start the conversation!
          </div>
        ) : (
          <div className="pb-4">
            {messages.map((message, i) => {
              const prevMessage = messages[i - 1]
              const groupingThresholdMs = messageGrouping === "never" ? 0 : messageGrouping === "10min" ? 10 * 60 * 1000 : 5 * 60 * 1000
              const msgDate = new Date(message.created_at)
              const prevDate = prevMessage ? new Date(prevMessage.created_at) : null
              const showDaySeparator = !prevDate || msgDate.toDateString() !== prevDate.toDateString()
              const isGrouped =
                messageGrouping !== "never" &&
                !showDaySeparator &&
                prevMessage &&
                prevMessage.author_id === message.author_id &&
                msgDate.getTime() -
                  new Date(prevMessage.created_at).getTime() <
                  groupingThresholdMs

              return (
                <div key={message.id}>
                  {showDaySeparator && (
                    <div className="flex items-center gap-3 my-3 px-4">
                      <div className="flex-1 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />
                      <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>
                        {formatDaySeparator(msgDate)}
                      </span>
                      <div className="flex-1 h-px" style={{ background: "var(--theme-bg-tertiary)" }} />
                    </div>
                  )}
                <MessageItem
                  message={message}
                  isGrouped={!!isGrouped}
                  currentUserId={currentUserId}
                  onReply={() => setReplyTo(message)}
                  onEdit={async (content) => {
                    const { error } = await supabase
                      .from("messages")
                      .update({ content, edited_at: new Date().toISOString() })
                      .eq("id", message.id)
                    if (!error) {
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === message.id
                            ? { ...m, content, edited_at: new Date().toISOString() }
                            : m
                        )
                      )
                    }
                  }}
                  onDelete={async () => {
                    const { error } = await supabase
                      .from("messages")
                      .delete()
                      .eq("id", message.id)
                    if (!error) {
                      setMessages((prev) => prev.filter((m) => m.id !== message.id))
                    }
                  }}
                  onReaction={async (emoji) => {
                    const previousReactions = message.reactions
                    const existing = message.reactions.find((r) => r.emoji === emoji && r.user_id === currentUserId)
                    const remove = Boolean(existing)
                    setMessages((prev) =>
                      prev.map((m) => {
                        if (m.id !== message.id) return m
                        const hasOwnReaction = m.reactions.some((r) => r.user_id === currentUserId && r.emoji === emoji)
                        return {
                          ...m,
                          reactions: remove
                            ? m.reactions.filter((r) => !(r.user_id === currentUserId && r.emoji === emoji))
                            : hasOwnReaction
                              ? m.reactions
                              : [...m.reactions, { message_id: message.id, user_id: currentUserId, emoji, created_at: new Date().toISOString() }],
                        }
                      })
                    )
                    try {
                      await sendReactionMutation({ messageId: message.id, emoji, remove, nonce: crypto.randomUUID() })
                    } catch {
                      setMessages((prev) =>
                        prev.map((m) => (m.id === message.id ? { ...m, reactions: previousReactions } : m))
                      )
                    }
                  }}                />
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      {thread.archived && !thread.locked && (
        <div
          className="px-3 py-1.5 text-xs text-center"
          style={{ color: "var(--theme-text-muted)", background: "var(--theme-bg-secondary)", borderTop: "1px solid var(--theme-bg-tertiary)" }}
        >
          This thread is archived. Sending a message will unarchive it.
        </div>
      )}
      {canSend ? (
        <MessageInput
          channelName={thread.name}
          draft={draft}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleSendMessage}
          onDraftChange={setDraftContent}
        />
      ) : (
        <div
          className="px-4 py-3 text-sm text-center flex-shrink-0"
          style={{ color: "var(--theme-text-muted)", background: "var(--theme-bg-secondary)", borderTop: "1px solid var(--theme-bg-tertiary)" }}
        >
          This thread is locked.
        </div>
      )}
    </div>
  )
}
