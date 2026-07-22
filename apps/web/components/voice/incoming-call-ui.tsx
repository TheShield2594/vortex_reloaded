"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Phone, PhoneOff, X } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import type { RealtimeChannel } from "@supabase/supabase-js"

// ── Types ────────────────────────────────────────────────────────────────────

interface CallerInfo {
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
}

interface IncomingCall {
  channelId: string
  caller: CallerInfo
  startedAt: number
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Auto-dismiss after 30 seconds if user doesn't answer. */
const RING_TIMEOUT_MS = 30_000

// ── IncomingCallUI ───────────────────────────────────────────────────────────

/**
 * IncomingCallUI — listens for DM voice call invitations via Supabase Realtime
 * and renders a full-screen-overlay incoming call notification with ringtone,
 * accept and decline buttons.
 *
 * Mounted at the app layout level so it works regardless of current route.
 */
export const IncomingCallUI = memo(function IncomingCallUI() {
  const currentUser = useAppStore((s) => s.currentUser)
  const voiceChannelId = useAppStore((s) => s.voiceChannelId)
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const supabaseRef = useRef(createClientSupabaseClient())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const incomingCallRef = useRef<IncomingCall | null>(null)
  // Keep ref in sync so broadcast handlers always see latest value
  incomingCallRef.current = incomingCall

  // Subscribe to incoming call signals on DM channels
  useEffect(() => {
    if (!currentUser) return

    const supabase = supabaseRef.current
    const channel = supabase.channel(`dm-incoming-call:${currentUser.id}`)
    channelRef.current = channel

    channel.on("broadcast", { event: "incoming-call" }, ({ payload }) => {
      if (
        !payload ||
        typeof payload.targetUserId !== "string" ||
        typeof payload.channelId !== "string" ||
        typeof payload.callerUserId !== "string" ||
        typeof payload.callerUsername !== "string"
      ) return
      if (payload.targetUserId !== currentUser.id) return
      // Don't show if already in a voice call
      if (useAppStore.getState().voiceChannelId) return

      setIncomingCall({
        channelId: payload.channelId,
        caller: {
          userId: payload.callerUserId,
          username: payload.callerUsername,
          displayName: (typeof payload.callerDisplayName === "string" ? payload.callerDisplayName : null),
          avatarUrl: (typeof payload.callerAvatarUrl === "string" ? payload.callerAvatarUrl : null),
        },
        startedAt: Date.now(),
      })
    })

    channel.on("broadcast", { event: "call-cancelled" }, ({ payload }) => {
      // Use ref to avoid stale closure — this handler is created once per
      // currentUser.id and must always read the latest incomingCall value.
      // The sender (dm-call.tsx) broadcasts { callerId }, so match on callerId.
      if (payload?.callerId === incomingCallRef.current?.caller.userId) {
        setIncomingCall(null)
        setElapsed(0)
      }
    })

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id])

  // Auto-dismiss timeout
  useEffect(() => {
    if (!incomingCall) return

    ringTimeoutRef.current = setTimeout(() => {
      dismissCall()
    }, RING_TIMEOUT_MS)

    return () => {
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current)
        ringTimeoutRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall?.channelId])

  // Elapsed timer for ring duration
  useEffect(() => {
    if (!incomingCall) return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - incomingCall.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [incomingCall])

  // Ring audio (Web Audio oscillator as fallback — no external audio file needed)
  useEffect(() => {
    if (!incomingCall) return

    let ctx: AudioContext | null = null
    let osc: OscillatorNode | null = null
    let gain: GainNode | null = null
    let interval: ReturnType<typeof setInterval> | null = null

    try {
      ctx = new AudioContext()
      osc = ctx.createOscillator()
      gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = 440
      gain.gain.value = 0
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()

      // Ring pattern: 0.5s on, 0.5s off
      let on = true
      function toggleRing() {
        if (gain) gain.gain.value = on ? 0.15 : 0
        on = !on
      }
      toggleRing()
      interval = setInterval(toggleRing, 500)
    } catch {
      // Audio not available — silent ring
    }

    return () => {
      if (interval) clearInterval(interval)
      try {
        osc?.stop()
        osc?.disconnect()
        gain?.disconnect()
        ctx?.close()
      } catch { /* ignore */ }
    }
  }, [incomingCall?.channelId])

  const dismissCall = useCallback(() => {
    setIncomingCall(null)
    setElapsed(0)
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current)
      ringTimeoutRef.current = null
    }
  }, [])

  /** Helper: subscribe to the DM call-notify channel, send the signal, then clean up. */
  const sendCallSignal = useCallback(
    async (channelId: string, signalType: "accept" | "decline"): Promise<void> => {
      const ch = supabaseRef.current.channel(`dm-call-notify:${channelId}`)
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            ch.subscribe((status: string) => {
              if (status === "SUBSCRIBED") resolve()
              else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                reject(new Error(status))
              }
            })
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Subscription timeout")), 5000)
          ),
        ])
        await ch.send({
          type: "broadcast",
          event: signalType === "accept" ? "call-accepted" : "call-declined",
          payload: signalType === "accept"
            ? { acceptedWithVideo: false }
            : {},
        })
      } catch (err) {
        console.error(`Failed to send ${signalType} signal:`, err)
      } finally {
        supabaseRef.current.removeChannel(ch)
      }
    },
    []
  )

  const handleAccept = useCallback(async () => {
    try {
      if (!incomingCall) return
      const channelId = incomingCall.channelId

      await sendCallSignal(channelId, "accept")
      // Navigate to the DM call
      window.location.href = `/dm/${channelId}`
    } catch (err) {
      console.error("Failed to accept call:", err)
    } finally {
      dismissCall()
    }
  }, [incomingCall, dismissCall, sendCallSignal])

  const handleDecline = useCallback(async () => {
    try {
      if (!incomingCall) return

      await sendCallSignal(incomingCall.channelId, "decline")
    } catch (err) {
      console.error("Failed to decline call:", err)
    } finally {
      dismissCall()
    }
  }, [incomingCall, dismissCall, sendCallSignal])

  // Keyboard shortcuts
  useEffect(() => {
    if (!incomingCall) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleAccept()
      } else if (e.key === "Escape") {
        handleDecline()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [incomingCall, handleAccept, handleDecline])

  if (!incomingCall) return null

  const displayName = incomingCall.caller.displayName || incomingCall.caller.username
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(8px)" }}
      role="alertdialog"
      aria-label={`Incoming call from ${displayName}`}
    >
      <div
        className="flex flex-col items-center gap-6 p-8 rounded-2xl shadow-2xl max-w-sm w-full mx-4"
        style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
      >
        {/* Caller avatar with ring animation */}
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: "var(--theme-success)" }} />
          <div className="absolute -inset-2 rounded-full animate-pulse opacity-30" style={{ border: "2px solid var(--theme-success)" }} />
          <Avatar className="w-24 h-24 relative">
            {incomingCall.caller.avatarUrl && <AvatarImage src={incomingCall.caller.avatarUrl} />}
            <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "32px" }}>
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Caller info */}
        <div className="text-center">
          <p className="text-lg font-semibold text-white">{displayName}</p>
          <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
            Incoming voice call...
          </p>
          <p className="text-xs mt-1 tabular-nums" style={{ color: "var(--theme-text-faint)" }}>
            {elapsed}s
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-8">
          {/* Decline */}
          <button
            onClick={handleDecline}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
            style={{ background: "var(--theme-danger)" }}
            aria-label="Decline call"
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>

          {/* Accept */}
          <button
            onClick={handleAccept}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95 animate-pulse"
            style={{ background: "var(--theme-success)" }}
            aria-label="Accept call"
          >
            <Phone className="w-7 h-7 text-white" />
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-[10px]" style={{ color: "var(--theme-text-faint)" }}>
          Press <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--theme-bg-tertiary)" }}>Enter</kbd> to accept
          {" "}&middot;{" "}
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--theme-bg-tertiary)" }}>Esc</kbd> to decline
        </p>
      </div>
    </div>
  )
})
