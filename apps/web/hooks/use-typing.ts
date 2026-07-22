"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"

const TYPING_TIMEOUT_MS = 5000

interface TypingUser {
  userId: string
  displayName: string
}

/** Broadcasts and listens for typing indicators on a channel via Supabase Realtime. Returns the list of currently-typing users plus `onKeystroke` / `onSent` callbacks for the input. */
export function useTyping(channelId: string, currentUserId: string, currentDisplayName: string): {
  typingUsers: TypingUser[]
  onKeystroke: () => void
  onSent: () => void
} {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const isTypingRef = useRef(false)
  const stopTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const subIdRef = useRef(0)
  const currentUserIdRef = useRef(currentUserId)
  currentUserIdRef.current = currentUserId

  useEffect(() => {
    const subId = ++subIdRef.current
    const bc = supabase.channel(`typing:${channelId}:${subId}`)

    bc.on("broadcast", { event: "typing" }, ({ payload }) => {
      const { userId, displayName, isTyping } = payload as {
        userId: string
        displayName: string
        isTyping: boolean
      }

      // Ignore own events
      if (userId === currentUserIdRef.current) return

      if (isTyping) {
        // Add or refresh user in typing list
        setTypingUsers((prev) => {
          if (prev.some((u) => u.userId === userId)) return prev
          return [...prev, { userId, displayName }]
        })

        // Auto-remove after timeout if no refresh
        const existing = typingTimeoutsRef.current.get(userId)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== userId))
          typingTimeoutsRef.current.delete(userId)
        }, TYPING_TIMEOUT_MS + 500)

        typingTimeoutsRef.current.set(userId, timer)
      } else {
        // Explicit stop
        const existing = typingTimeoutsRef.current.get(userId)
        if (existing) clearTimeout(existing)
        typingTimeoutsRef.current.delete(userId)
        setTypingUsers((prev) => prev.filter((u) => u.userId !== userId))
      }
    })

    bc.subscribe()
    channelRef.current = bc

    return () => {
      supabase.removeChannel(bc)
      typingTimeoutsRef.current.forEach((t) => clearTimeout(t))
      typingTimeoutsRef.current.clear()
      if (stopTypingTimerRef.current) {
        clearTimeout(stopTypingTimerRef.current)
        stopTypingTimerRef.current = null
      }
      isTypingRef.current = false
    }
  }, [channelId, supabase])

  const sendTypingStart = useCallback(() => {
    if (!channelRef.current) return

    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUserId, displayName: currentDisplayName, isTyping: true },
    })
  }, [currentUserId, currentDisplayName])

  const sendTypingStop = useCallback(() => {
    if (!channelRef.current) return

    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUserId, displayName: currentDisplayName, isTyping: false },
    })
  }, [currentUserId, currentDisplayName])

  // Call this from message input onChange
  const onKeystroke = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true
      sendTypingStart()
    }

    // Reset the auto-stop timer
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current)
    stopTypingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false
      sendTypingStop()
    }, TYPING_TIMEOUT_MS)
  }, [sendTypingStart, sendTypingStop])

  // Call this when message is sent (stop typing immediately)
  const onSent = useCallback(() => {
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current)
    if (isTypingRef.current) {
      isTypingRef.current = false
      sendTypingStop()
    }
  }, [sendTypingStop])

  return { typingUsers, onKeystroke, onSent }
}
