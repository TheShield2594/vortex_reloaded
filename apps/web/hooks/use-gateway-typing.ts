"use client"

/**
 * Socket.IO–based typing indicators.
 *
 * Drop-in replacement for useTyping that routes typing events through
 * the unified Socket.IO gateway instead of Supabase Realtime broadcast.
 * Latency drops from ~200ms to <100ms, and all events share a single connection.
 *
 * #595: WebSocket-Based Presence & Typing
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { useGatewayContext } from "./use-gateway-context"
import type { GatewayServerEvents } from "@vortex/shared"

const TYPING_TIMEOUT_MS = 3000

interface TypingUser {
  userId: string
  displayName: string
}

export function useGatewayTyping(
  channelId: string,
  currentUserId: string,
  _currentDisplayName: string,
) {
  const gateway = useGatewayContext()
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const isTypingRef = useRef(false)
  const stopTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const removeListener = gateway.addTypingListener(
      channelId,
      (data: GatewayServerEvents["gateway:typing"]) => {
        // Ignore own events
        if (data.userId === currentUserId) return

        if (data.isTyping) {
          setTypingUsers((prev) => {
            if (prev.some((u) => u.userId === data.userId)) return prev
            return [...prev, { userId: data.userId, displayName: data.displayName }]
          })

          const existing = typingTimeoutsRef.current.get(data.userId)
          if (existing) clearTimeout(existing)

          const timer = setTimeout(() => {
            setTypingUsers((prev) => prev.filter((u) => u.userId !== data.userId))
            typingTimeoutsRef.current.delete(data.userId)
          }, TYPING_TIMEOUT_MS + 500)

          typingTimeoutsRef.current.set(data.userId, timer)
        } else {
          const existing = typingTimeoutsRef.current.get(data.userId)
          if (existing) clearTimeout(existing)
          typingTimeoutsRef.current.delete(data.userId)
          setTypingUsers((prev) => prev.filter((u) => u.userId !== data.userId))
        }
      },
    )

    return () => {
      removeListener()
      typingTimeoutsRef.current.forEach((t) => clearTimeout(t))
      typingTimeoutsRef.current.clear()
      if (stopTypingTimerRef.current) {
        clearTimeout(stopTypingTimerRef.current)
        stopTypingTimerRef.current = null
      }
      isTypingRef.current = false
    }
  }, [channelId, currentUserId, gateway])

  const onKeystroke = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true
      gateway.sendTyping(channelId, true)
    }

    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current)
    stopTypingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false
      gateway.sendTyping(channelId, false)
    }, TYPING_TIMEOUT_MS)
  }, [channelId, gateway])

  const onSent = useCallback(() => {
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current)
    if (isTypingRef.current) {
      isTypingRef.current = false
      gateway.sendTyping(channelId, false)
    }
  }, [channelId, gateway])

  return { typingUsers, onKeystroke, onSent }
}
