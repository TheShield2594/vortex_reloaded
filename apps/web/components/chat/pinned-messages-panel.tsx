"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pin, PinOff, X, Loader2, ExternalLink } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { format } from "date-fns"

interface PinnedMessage {
  id: string
  content: string
  created_at: string
  pinned_at: string | null
  author: {
    username: string
    display_name: string | null
    avatar_url: string | null
  } | null
}

interface Props {
  channelId: string
  channelName: string
  canManageMessages?: boolean
  onClose: () => void
  onJumpToMessage: (messageId: string) => void
}

export function PinnedMessagesPanel({ channelId, channelName, canManageMessages = false, onClose, onJumpToMessage }: Props) {
  const [supabase] = useState(() => createClientSupabaseClient())
  const [messages, setMessages] = useState<PinnedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const subIdRef = useRef(0)

  const upsertPinnedMessage = useCallback((incoming: PinnedMessage) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex((message) => message.id === incoming.id)
      const next = existingIndex === -1
        ? [...prev, incoming]
        : prev.map((message, index) => (index === existingIndex ? incoming : message))

      return next.sort((a, b) => {
        const aTs = a.pinned_at ? Date.parse(a.pinned_at) : 0
        const bTs = b.pinned_at ? Date.parse(b.pinned_at) : 0
        return bTs - aTs
      })
    })
  }, [])

  const loadPinnedMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    try {
      const { data, error: dbError } = await supabase
        .from("messages")
        .select(`
          id,
          content,
          created_at,
          pinned_at,
          author:users!messages_author_id_fkey(username, display_name, avatar_url)
        `)
        .eq("channel_id", channelId)
        .eq("pinned", true)
        .is("deleted_at", null)
        .order("pinned_at", { ascending: false })
        .limit(50)

      if (dbError) {
        const denied = dbError.code === "42501" || /permission denied/i.test(dbError.message ?? "")
        if (denied) {
          setPermissionDenied(true)
          setMessages([])
          return
        }
        throw dbError
      }
      setMessages((data ?? []) as PinnedMessage[])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load pinned messages")
    } finally {
      setLoading(false)
    }
  }, [channelId, supabase])

  useEffect(() => {
    loadPinnedMessages()
  }, [loadPinnedMessages])

  useEffect(() => {
    const subId = ++subIdRef.current
    const realtimeChannel = supabase
      .channel(`pinned-messages:${channelId}:${subId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `channel_id=eq.${channelId}`,
      }, async (payload) => {
        const next = payload.new as { id: string; pinned?: boolean; pinned_at?: string | null }
        if (!next.id) return
        if (!next.pinned) {
          setMessages((prev) => prev.filter((message) => message.id !== next.id))
          return
        }
        const { data } = await supabase
          .from("messages")
          .select(`
            id,
            content,
            created_at,
            pinned_at,
            author:users!messages_author_id_fkey(username, display_name, avatar_url)
          `)
          .eq("id", next.id)
          .single()

        if (data) {
          upsertPinnedMessage(data as PinnedMessage)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(realtimeChannel)
    }
  }, [channelId, supabase, upsertPinnedMessage])

  const showEmptyState = useMemo(
    () => !loading && !error && !permissionDenied && messages.length === 0,
    [error, loading, messages.length, permissionDenied]
  )

  function truncateContent(content: string, maxLen = 160): string {
    const clean = content.replace(/\*\*|__|~~|\|\||`{1,3}/g, "")
    return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean
  }

  return (
    <div
      className="flex flex-col w-72 h-full border-l"
      style={{
        background: "var(--theme-bg-secondary)",
        borderColor: "var(--theme-bg-tertiary)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--theme-bg-tertiary)" }}
      >
        <div className="flex items-center gap-2">
          <Pin className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
          <span className="font-semibold text-sm" style={{ color: "var(--theme-text-bright)" }}>
            Pinned Messages
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors focus-ring"
          style={{ color: "var(--theme-text-muted)" }}
          aria-label="Close pinned messages"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--theme-accent)" }} />
          </div>
        )}

        {error && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm" style={{ color: "var(--theme-danger)" }}>{error}</p>
            <button
              type="button"
              onClick={loadPinnedMessages}
              className="mt-2 text-xs underline"
              style={{ color: "var(--theme-accent)" }}
            >
              Retry
            </button>
          </div>
        )}

        {permissionDenied && (
          <div className="flex flex-col items-center justify-center py-12 px-4 gap-3">
            <PinOff className="w-8 h-8" style={{ color: "var(--theme-text-faint)" }} />
            <p className="text-sm text-center" style={{ color: "var(--theme-text-muted)" }}>
              You don&rsquo;t have permission to view pinned messages in #{channelName}.
            </p>
          </div>
        )}

        {showEmptyState && (
          <div className="flex flex-col items-center justify-center py-12 px-4 gap-3">
            <Pin className="w-8 h-8" style={{ color: "var(--theme-text-faint)" }} />
            <p className="text-sm text-center" style={{ color: "var(--theme-text-muted)" }}>
              No pinned messages in #{channelName}.
            </p>
            <p className="text-xs text-center" style={{ color: "var(--theme-text-faint)" }}>
              Right-click a message and choose &ldquo;Pin&rdquo; to add it here.
            </p>
          </div>
        )}

        {!loading && !permissionDenied && messages.length > 0 && (
          <div className="divide-y" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
            {messages.map((message) => {
              const author = Array.isArray(message.author) ? message.author[0] : message.author
              const authorName = (author as { display_name?: string; username: string } | null)?.display_name
                || (author as { username: string } | null)?.username
                || "Unknown"
              return (
                <div key={message.id} className="px-4 py-3 group hover:bg-white/5 transition-colors">
                  {/* Author + date */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold" style={{ color: "var(--theme-text-secondary)" }}>
                      {authorName}
                    </span>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch-visible transition-opacity">
                      {canManageMessages && (
                        <button
                          type="button"
                          onClick={async () => {
                            setMessages((prev) => prev.filter((m) => m.id !== message.id))
                            const res = await fetch(`/api/messages/${message.id}/pin`, { method: "DELETE" })
                            if (!res.ok) {
                              loadPinnedMessages()
                            }
                          }}
                          className="flex items-center gap-1 text-xs transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--theme-accent)] rounded-sm"
                          style={{ color: "var(--theme-text-muted)" }}
                          title="Unpin message"
                          aria-label={`Unpin message from ${authorName}`}
                        >
                          <PinOff className="w-3 h-3" />
                          Unpin
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onJumpToMessage(message.id)
                          onClose()
                        }}
                        className="flex items-center gap-1 text-xs transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--theme-accent)] rounded-sm"
                        style={{ color: "var(--theme-accent)" }}
                        title="Jump to message"
                        aria-label={`Jump to pinned message from ${authorName}`}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Jump
                      </button>
                    </div>
                  </div>

                  {/* Content */}
                  <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-primary)" }}>
                    {truncateContent(message.content)}
                  </p>

                  {/* Pinned timestamp */}
                  {message.pinned_at && (
                    <p className="text-xs mt-1.5" style={{ color: "var(--theme-text-faint)" }}>
                      Pinned {format(new Date(message.pinned_at), "MMM d, yyyy")}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
