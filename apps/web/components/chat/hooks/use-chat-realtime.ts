import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { MessageWithAuthor, ReactionRow } from "@/types/database"
import type { OutboxEntry } from "@/lib/chat-outbox"
import { removeOutboxEntry } from "@/lib/chat-outbox"

import { DISPLAY_LIMIT } from "@/components/chat/constants"

function sortMessagesChronologically(items: MessageWithAuthor[]): MessageWithAuthor[] {
  const timestamps = new Map<string, number>()
  for (const item of items) {
    timestamps.set(item.id, Date.parse(item.created_at))
  }
  return [...items].sort((a, b) => {
    const ts = (timestamps.get(a.id) ?? 0) - (timestamps.get(b.id) ?? 0)
    return ts !== 0 ? ts : a.id.localeCompare(b.id)
  })
}

interface UseChatRealtimeCallbacksArgs {
  setMessages: Dispatch<SetStateAction<MessageWithAuthor[]>>
  setAndPersistOutbox: (updater: (current: OutboxEntry[]) => OutboxEntry[]) => void
  currentUserId: string
}

interface RealtimeCallbacks {
  onInsert: (message: MessageWithAuthor) => void
  onUpdate: (message: MessageWithAuthor) => void
  onReactionInsert: (reaction: ReactionRow) => void
  onReactionDelete: (reaction: ReactionRow) => void
  upsertMessage: (incoming: MessageWithAuthor) => void
  handleVisibilityResync: (channelId: string, serverId: string, userId: string | undefined) => Promise<void>
}

/** Extracts realtime message/reaction callbacks from ChatArea for testability and reuse. */
export function useChatRealtimeCallbacks({
  setMessages,
  setAndPersistOutbox,
  currentUserId,
}: UseChatRealtimeCallbacksArgs): RealtimeCallbacks {
  const [animatedMessageIds, setAnimatedMessageIds] = useState<Set<string>>(new Set())
  const animatedMessageTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const upsertMessage = useCallback((incoming: MessageWithAuthor) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex((m) => {
        if (m.id === incoming.id) return true
        if (!m.client_nonce || !incoming.client_nonce) return false
        return (
          m.client_nonce === incoming.client_nonce
          && m.author_id === incoming.author_id
          && m.channel_id === incoming.channel_id
        )
      })

      const isNewMessage = existingIndex === -1
      const next = isNewMessage
        ? [...prev, incoming]
        : prev.map((message, idx) => (idx === existingIndex ? { ...prev[existingIndex], ...incoming } : message))

      if (isNewMessage) {
        setAnimatedMessageIds((current) => {
          const nextIds = new Set(current)
          nextIds.add(incoming.id)
          return nextIds
        })

        const existingTimer = animatedMessageTimersRef.current.get(incoming.id)
        if (existingTimer) clearTimeout(existingTimer)
        const timer = setTimeout(() => {
          setAnimatedMessageIds((current) => {
            if (!current.has(incoming.id)) return current
            const nextIds = new Set(current)
            nextIds.delete(incoming.id)
            return nextIds
          })
          animatedMessageTimersRef.current.delete(incoming.id)
        }, 220)
        animatedMessageTimersRef.current.set(incoming.id, timer)
      }

      const sorted = sortMessagesChronologically(next)
      return sorted.length > DISPLAY_LIMIT ? sorted.slice(sorted.length - DISPLAY_LIMIT) : sorted
    })
  }, [setMessages])

  const onInsert = useCallback((newMessage: MessageWithAuthor) => {
    upsertMessage(newMessage)
    setAndPersistOutbox((current) =>
      removeOutboxEntry(current, newMessage.client_nonce ?? newMessage.id)
    )
  }, [upsertMessage, setAndPersistOutbox])

  const onUpdate = useCallback((updatedMessage: MessageWithAuthor) => {
    setMessages((prev) => {
      if (updatedMessage.deleted_at) {
        return prev.filter((m) => m.id !== updatedMessage.id)
      }
      return prev.map((m) => m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m)
    })
    if (updatedMessage.deleted_at) {
      setAndPersistOutbox((current) => removeOutboxEntry(current, updatedMessage.id))
    }
  }, [setMessages, setAndPersistOutbox])

  const onReactionInsert = useCallback((reaction: ReactionRow) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== reaction.message_id) return m
        if (m.reactions.some((r) => r.emoji === reaction.emoji && r.user_id === reaction.user_id)) return m
        return { ...m, reactions: [...m.reactions, reaction] }
      })
    )
  }, [setMessages])

  const onReactionDelete = useCallback((reaction: ReactionRow) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== reaction.message_id) return m
        return { ...m, reactions: m.reactions.filter((r) => !(r.emoji === reaction.emoji && r.user_id === reaction.user_id)) }
      })
    )
  }, [setMessages])

  const handleVisibilityResync = useCallback(async (channelId: string, serverId: string, userId: string | undefined): Promise<void> => {
    window.dispatchEvent(new CustomEvent("vortex:realtime-retry"))
    try {
      const res = await fetch(`/api/messages?channelId=${channelId}&limit=100`)
      if (!res.ok) return
      const latest = (await res.json()) as MessageWithAuthor[]
      if (!Array.isArray(latest) || latest.length === 0) return

      // Clear outbox entries for messages confirmed by resync
      const confirmedNonces = new Set(
        latest.filter((m) => m.client_nonce).map((m) => m.client_nonce!)
      )
      if (confirmedNonces.size > 0) {
        setAndPersistOutbox((current) =>
          current.filter((entry) => !confirmedNonces.has(entry.id))
        )
      }

      setMessages((prev) => {
        // Nonce-aware dedup: match by both id and client_nonce to replace
        // optimistic entries with server-confirmed messages
        const byId = new Map(prev.map((m) => [m.id, m]))
        const byNonce = new Map<string, MessageWithAuthor>()
        for (const m of prev) {
          if (m.client_nonce) byNonce.set(m.client_nonce, m)
        }

        for (const incoming of latest) {
          byId.set(incoming.id, incoming)
          if (incoming.client_nonce && byNonce.has(incoming.client_nonce)) {
            const optimistic = byNonce.get(incoming.client_nonce)!
            if (optimistic.id !== incoming.id) {
              byId.delete(optimistic.id)
            }
          }
        }

        const merged = sortMessagesChronologically([...byId.values()])
        return merged.length > DISPLAY_LIMIT ? merged.slice(merged.length - DISPLAY_LIMIT) : merged
      })
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.error("visibilitychange resync failed", {
          action: "refreshMessages",
          channelId,
          route: `/channels/${serverId}/${channelId}`,
          currentUserId: userId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }, [setMessages])

  // Clean up animation timers on unmount to prevent stale state updates
  useEffect(() => {
    return () => {
      for (const timer of animatedMessageTimersRef.current.values()) {
        clearTimeout(timer)
      }
      animatedMessageTimersRef.current.clear()
    }
  }, [])

  return {
    onInsert,
    onUpdate,
    onReactionInsert,
    onReactionDelete,
    upsertMessage,
    handleVisibilityResync,
  }
}
