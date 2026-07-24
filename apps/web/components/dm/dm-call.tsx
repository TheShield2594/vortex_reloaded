"use client"

/**
 * DM Voice/Video Call signaling helpers.
 *
 * Architecture:
 * - Caller clicks Phone/Video button → sends "invite" via the Socket.IO gateway
 * - Callee sees incoming call toast → accepts (sends "accept") or declines ("decline")
 * - Both sides enter the call screen (see DMCallView in dm-channel-area.tsx — LiveKit
 *   SFU, a single `Room.connect()` to a room scoped to this DM channel)
 * - Either party can hang up, or the caller can cancel while ringing ("cancel")
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { Phone, PhoneOff, Video, Loader2 } from "lucide-react"
import { useGatewayContext } from "@/hooks/use-gateway-context"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"

interface IncomingCall {
  callerId: string
  callerName: string
  callerAvatar: string | null
  channelId: string
  withVideo: boolean
}

// ─── Incoming Call Toast ───────────────────────────────────────────────────────

interface IncomingCallToastProps {
  call: IncomingCall
  onAccept: (withVideo: boolean) => void
  onDecline: () => void
}

/** Fixed-position toast showing an incoming voice/video call with accept (audio/video) and decline buttons. */
export function IncomingCallToast({ call, onAccept, onDecline }: IncomingCallToastProps) {
  return (
    <div
      className="fixed bottom-6 right-6 z-50 rounded-xl shadow-2xl p-4 flex items-center gap-4 min-w-72"
      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
    >
      {call.callerAvatar ? (
        <img src={call.callerAvatar} alt={`${call.callerName}'s avatar`} className="w-12 h-12 rounded-full object-cover" />
      ) : (
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ background: "var(--theme-accent)" }}>
          {call.callerName.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold truncate">{call.callerName}</div>
        <div className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
          {call.withVideo ? "Incoming video call…" : "Incoming voice call…"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onAccept(false)}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ background: "var(--theme-success)" }}
          title="Accept (voice)"
          aria-label="Accept voice call"
        >
          <Phone className="w-4 h-4 text-white" />
        </button>
        {call.withVideo && (
          <button
            onClick={() => onAccept(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "var(--theme-accent)" }}
            title="Accept (video)"
            aria-label="Accept video call"
          >
            <Video className="w-4 h-4 text-white" />
          </button>
        )}
        <button
          onClick={onDecline}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ background: "var(--theme-danger)" }}
          title="Decline"
          aria-label="Decline call"
        >
          <PhoneOff className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  )
}

// ─── Caller Ringing Overlay ────────────────────────────────────────────────────

interface CallerRingingOverlayProps {
  partnerName: string
  partnerAvatar: string | null
  withVideo: boolean
  onCancel: () => void
}

/** Shown on the caller's side while waiting for the callee to pick up (max 30 s). */
export function CallerRingingOverlay({ partnerName, partnerAvatar, withVideo, onCancel }: CallerRingingOverlayProps) {
  const initials = partnerName.slice(0, 2).toUpperCase()
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6" style={{ background: "var(--theme-bg-tertiary)" }}>
      <Avatar className="w-24 h-24">
        {partnerAvatar && <AvatarImage src={partnerAvatar} alt={`${partnerName}'s avatar`} />}
        <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "32px" }}>{initials}</AvatarFallback>
      </Avatar>
      <div className="text-center">
        <div className="text-white font-semibold text-xl mb-1">{partnerName}</div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          {withVideo ? "Calling (video)…" : "Calling…"}
        </div>
      </div>
      <button
        onClick={onCancel}
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: "var(--theme-danger)" }}
        title="Cancel call"
        aria-label="Cancel call"
      >
        <PhoneOff className="w-6 h-6 text-white" />
      </button>
    </div>
  )
}

// ─── useDMCall hook ─────────────────────────────────────────────────────────────
// Manages incoming call state for a DM channel

/** How long the caller rings before auto-cancelling. */
const RING_TIMEOUT_MS = 30_000
/**
 * How long a callee's incoming-call toast lives before auto-dismissing. Slightly
 * longer than the caller's ring window so a normal "cancel" arrives first; the
 * timeout is the backstop for the group case where the caller stops ringing
 * (because another member accepted) and so never sends a cancel to the rest
 * (issue #58 §5).
 */
const INCOMING_TIMEOUT_MS = 35_000

/**
 * Manages incoming/outgoing DM call state and signaling via the Socket.IO gateway.
 *
 * `otherMemberCount` is the number of *other* members in the channel (1 for a
 * 1:1 DM). It drives the group-ring semantics: the caller only gives up once
 * every other member has declined, so one member's decline can't tear down a
 * ring others might still answer.
 */
export function useDMCall(
  channelId: string,
  currentUserId: string,
  currentUserName: string,
  otherMemberCount = 1,
) {
  const gateway = useGatewayContext()
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [activeCall, setActiveCall] = useState<{ withVideo: boolean } | null>(null)
  const [ringing, setRinging] = useState<{ withVideo: boolean } | null>(null)
  const incomingCallRef = useRef(incomingCall)
  incomingCallRef.current = incomingCall
  const ringingRef = useRef(ringing)
  ringingRef.current = ringing
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const incomingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // User IDs that have declined the current outgoing ring (group calls).
  const declinedRef = useRef<Set<string>>(new Set())
  // Read through a ref so the listener effect doesn't depend on it: membership
  // hydrates after mount (1 → N), and re-running the effect would fire its
  // cleanup, clearing the live ring/incoming timers and stranding an
  // incoming-call toast or an outgoing ring that can never time out.
  const otherMemberCountRef = useRef(otherMemberCount)
  otherMemberCountRef.current = otherMemberCount

  const clearIncoming = useCallback(() => {
    if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
    setIncomingCall(null)
  }, [])

  const stopRinging = useCallback(() => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
    declinedRef.current.clear()
    setRinging(null)
  }, [])

  useEffect(() => {
    const removeListener = gateway.addCallSignalListener(channelId, (data) => {
      if (data.userId === currentUserId) return

      switch (data.type) {
        case "invite":
          setIncomingCall({
            callerId: data.userId,
            callerName: data.callerName ?? "Unknown",
            callerAvatar: data.callerAvatar ?? null,
            channelId,
            withVideo: data.withVideo ?? false,
          })
          // Auto-dismiss the toast if the ring is never explicitly cancelled.
          if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current)
          incomingTimeoutRef.current = setTimeout(() => {
            incomingTimeoutRef.current = null
            setIncomingCall(null)
          }, INCOMING_TIMEOUT_MS)
          break
        case "cancel":
          if (incomingCallRef.current?.callerId === data.userId) clearIncoming()
          break
        case "accept":
          // Only the caller (still ringing) acts on an accept.
          if (!ringingRef.current) return
          stopRinging()
          setActiveCall({ withVideo: data.withVideo ?? false })
          break
        case "decline":
          if (!ringingRef.current) return
          // Group ring: give up only once every other member has declined, so a
          // single decline can't cancel a ring others might still answer.
          declinedRef.current.add(data.userId)
          if (declinedRef.current.size >= otherMemberCountRef.current) stopRinging()
          break
      }
    })

    return () => {
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
      if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
      removeListener()
    }
  }, [channelId, currentUserId, gateway, clearIncoming, stopRinging])

  const startCall = useCallback((withVideo: boolean, callerAvatar?: string | null) => {
    declinedRef.current.clear()
    gateway.sendCallSignal({ channelId, type: "invite", withVideo, callerName: currentUserName, callerAvatar: callerAvatar ?? null })
    setRinging({ withVideo })
    ringTimeoutRef.current = setTimeout(() => {
      ringTimeoutRef.current = null
      declinedRef.current.clear()
      gateway.sendCallSignal({ channelId, type: "cancel" })
      setRinging(null)
    }, RING_TIMEOUT_MS)
  }, [channelId, currentUserName, gateway])

  const cancelCall = useCallback(() => {
    stopRinging()
    gateway.sendCallSignal({ channelId, type: "cancel" })
  }, [channelId, gateway, stopRinging])

  const acceptCall = useCallback((withVideo: boolean) => {
    gateway.sendCallSignal({ channelId, type: "accept", withVideo })
    clearIncoming()
    setActiveCall({ withVideo })
  }, [channelId, gateway, clearIncoming])

  const declineCall = useCallback(() => {
    gateway.sendCallSignal({ channelId, type: "decline" })
    clearIncoming()
  }, [channelId, gateway, clearIncoming])

  const endCall = useCallback(() => {
    setActiveCall(null)
  }, [])

  return { incomingCall, activeCall, ringing, startCall, cancelCall, acceptCall, declineCall, endCall }
}
