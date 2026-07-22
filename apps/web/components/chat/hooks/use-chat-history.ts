import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import { flushSync } from "react-dom"
import type { MessageWithAuthor } from "@/types/database"

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

interface UseChatHistoryArgs {
  channelId: string
  messageScrollerRef: MutableRefObject<HTMLDivElement | null>
  messagesRef: MutableRefObject<MessageWithAuthor[]>
  setMessages: Dispatch<SetStateAction<MessageWithAuthor[]>>
}

interface UseChatHistoryReturn {
  hasMoreHistory: boolean
  setHasMoreHistory: Dispatch<SetStateAction<boolean>>
  isPaginating: boolean
  paginationRequestRef: MutableRefObject<Promise<unknown> | null>
  loadOlderMessages: () => Promise<void>
  ensureMessageLoaded: (messageId: string) => Promise<boolean>
  loadMessageContextWindow: (messageId: string) => Promise<boolean>
  backfillMissedMessages: () => Promise<void>
}

export function useChatHistory({
  channelId,
  messageScrollerRef,
  messagesRef,
  setMessages,
}: UseChatHistoryArgs): UseChatHistoryReturn {
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [isPaginating, setIsPaginating] = useState(false)
  const paginationRequestRef = useRef<Promise<unknown> | null>(null)

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    const container = messageScrollerRef.current
    const currentMessages = messagesRef.current
    if (!container || !hasMoreHistory || currentMessages.length === 0) return

    if (paginationRequestRef.current) {
      await paginationRequestRef.current.catch(() => undefined)
      return
    }

    setIsPaginating(true)

    const anchorId = currentMessages[0]?.id ?? null
    const anchorEl = anchorId ? document.getElementById(`message-${anchorId}`) : null
    const anchorRect = anchorEl?.getBoundingClientRect() ?? null

    const paginationPromise = (async () => {
      const oldest = currentMessages[0]
      const before = encodeURIComponent(oldest.created_at)

      let older: MessageWithAuthor[] | null = null
      try {
        const res = await fetch(`/api/messages?channelId=${channelId}&before=${before}&limit=50`)
        if (!res.ok) return
        older = await res.json() as MessageWithAuthor[]
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to paginate older messages", error)
        }
        return
      }

      if (!Array.isArray(older) || older.length === 0) {
        setHasMoreHistory(false)
        return
      }

      if (older.length < 50) {
        setHasMoreHistory(false)
      }

      flushSync(() => {
        setMessages((prev) => {
          const known = new Set(prev.map((message) => message.id))
          const newItems = older.filter((message) => !known.has(message.id))
          const merged = sortMessagesChronologically([...newItems, ...prev])
          if (merged.length > DISPLAY_LIMIT) {
            return merged.slice(merged.length - DISPLAY_LIMIT)
          }
          return merged
        })
      })

      if (anchorId && anchorRect && container) {
        const updatedAnchorEl = document.getElementById(`message-${anchorId}`)
        const updatedRect = updatedAnchorEl?.getBoundingClientRect() ?? null
        if (updatedRect) {
          const delta = updatedRect.top - anchorRect.top
          if (Math.abs(delta) > 2) {
            container.scrollTop += delta
          }
        }
      }
    })()

    paginationRequestRef.current = paginationPromise

    try {
      await paginationPromise
    } finally {
      if (paginationRequestRef.current === paginationPromise) {
        paginationRequestRef.current = null
      }
      setIsPaginating(false)
    }
  }, [channelId, hasMoreHistory, messageScrollerRef, messagesRef, setMessages])

  const ensureMessageLoaded = useCallback(async (messageId: string): Promise<boolean> => {
    if (messagesRef.current.some((message) => message.id === messageId)) return true

    if (paginationRequestRef.current) {
      await paginationRequestRef.current.catch(() => undefined)
      if (messagesRef.current.some((message) => message.id === messageId)) return true
    }

    setIsPaginating(true)
    const paginationPromise = (async () => {
      let attempts = 0
      let localHasMore = hasMoreHistory
      let cursor = messagesRef.current[0]?.created_at ?? null

      while (attempts < 8 && localHasMore && cursor) {
        attempts += 1

        let older: MessageWithAuthor[] | null = null
        try {
          const res = await fetch(`/api/messages?channelId=${channelId}&before=${encodeURIComponent(cursor)}&limit=50`)
          if (!res.ok) return false
          older = await res.json() as MessageWithAuthor[]
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.error("Failed to load message jump target", error)
          }
          return false
        }

        if (!Array.isArray(older) || older.length === 0) {
          localHasMore = false
          setHasMoreHistory(false)
          return false
        }

        setMessages((prev) => {
          const known = new Set(prev.map((message) => message.id))
          const merged = [...older.filter((message) => !known.has(message.id)), ...prev]
          return sortMessagesChronologically(merged)
        })

        if (older.some((message) => message.id === messageId)) {
          return true
        }

        cursor = older[0]?.created_at ?? null
        if (older.length < 50) {
          localHasMore = false
          setHasMoreHistory(false)
        }
      }

      return false
    })()

    paginationRequestRef.current = paginationPromise

    try {
      return await paginationPromise
    } finally {
      if (paginationRequestRef.current === paginationPromise) {
        paginationRequestRef.current = null
      }
      setIsPaginating(false)
    }
  }, [channelId, hasMoreHistory, messagesRef, setMessages])

  const loadMessageContextWindow = useCallback(async (messageId: string): Promise<boolean> => {
    type ContextPayload = { messages?: MessageWithAuthor[]; hasMoreBefore?: boolean }

    try {
      const res = await fetch(`/api/messages?channelId=${channelId}&around=${encodeURIComponent(messageId)}&limit=25`)
      if (!res.ok) return false
      const payload = await res.json() as ContextPayload
      const contextMessages = Array.isArray(payload?.messages) ? payload.messages : []
      if (contextMessages.length === 0 || !contextMessages.some((message) => message.id === messageId)) return false
      setMessages(sortMessagesChronologically(contextMessages))
      setHasMoreHistory(Boolean(payload.hasMoreBefore))
      return true
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to load message context window", error)
      }
      return false
    }
  }, [channelId, setMessages])

  const backfillMissedMessages = useCallback(async (): Promise<void> => {
    const current = messagesRef.current
    const lastMessage = current[current.length - 1]
    if (!lastMessage) return
    try {
      const res = await fetch(
        `/api/messages?channelId=${channelId}&after=${encodeURIComponent(lastMessage.created_at)}&limit=100`
      )
      if (!res.ok) return
      const missed = (await res.json()) as MessageWithAuthor[]
      if (!Array.isArray(missed) || missed.length === 0) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const newItems = missed.filter((m) => !known.has(m.id))
        if (newItems.length === 0) return prev
        const merged = sortMessagesChronologically([...prev, ...newItems])
        return merged.length > DISPLAY_LIMIT ? merged.slice(merged.length - DISPLAY_LIMIT) : merged
      })
    } catch {
      // Best-effort backfill — realtime events will catch up
    }
  }, [channelId, messagesRef, setMessages])

  return {
    hasMoreHistory,
    setHasMoreHistory,
    isPaginating,
    paginationRequestRef,
    loadOlderMessages,
    ensureMessageLoaded,
    loadMessageContextWindow,
    backfillMissedMessages,
  }
}
