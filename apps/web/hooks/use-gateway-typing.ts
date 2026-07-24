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

/**
 * Returns the user IDs currently typing in `channelId` (excluding the current
 * user). Deliberately IDs, not names: `gateway:typing` carries only the
 * authenticated `userId`, so callers resolve the label from their own trusted
 * channel-membership data rather than trusting anything off the wire.
 */
export function useGatewayTyping(channelId: string, currentUserId: string) {
  const gateway = useGatewayContext()
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
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
          setTypingUserIds((prev) => (prev.includes(data.userId) ? prev : [...prev, data.userId]))

          const existing = typingTimeoutsRef.current.get(data.userId)
          if (existing) clearTimeout(existing)

          const timer = setTimeout(() => {
            setTypingUserIds((prev) => prev.filter((id) => id !== data.userId))
            typingTimeoutsRef.current.delete(data.userId)
          }, TYPING_TIMEOUT_MS + 500)

          typingTimeoutsRef.current.set(data.userId, timer)
        } else {
          const existing = typingTimeoutsRef.current.get(data.userId)
          if (existing) clearTimeout(existing)
          typingTimeoutsRef.current.delete(data.userId)
          setTypingUserIds((prev) => prev.filter((id) => id !== data.userId))
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

  return { typingUserIds, onKeystroke, onSent }
}
