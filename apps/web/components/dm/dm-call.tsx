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

/** Manages incoming/outgoing DM call state and signaling via the Socket.IO gateway. */
export function useDMCall(channelId: string, currentUserId: string, currentUserName: string) {
  const gateway = useGatewayContext()
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [activeCall, setActiveCall] = useState<{ withVideo: boolean } | null>(null)
  const [ringing, setRinging] = useState<{ withVideo: boolean } | null>(null)
  const incomingCallRef = useRef(incomingCall)
  incomingCallRef.current = incomingCall
  const ringingRef = useRef(ringing)
  ringingRef.current = ringing
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
          break
        case "cancel":
          if (incomingCallRef.current?.callerId === data.userId) setIncomingCall(null)
          break
        case "accept":
          if (!ringingRef.current) return
          if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
          setRinging(null)
          setActiveCall({ withVideo: data.withVideo ?? false })
          break
        case "decline":
          if (!ringingRef.current) return
          if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
          setRinging(null)
          break
      }
    })

    return () => {
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
      removeListener()
    }
  }, [channelId, currentUserId, gateway])

  const startCall = useCallback((withVideo: boolean, callerAvatar?: string | null) => {
    gateway.sendCallSignal({ channelId, type: "invite", withVideo, callerName: currentUserName, callerAvatar: callerAvatar ?? null })
    setRinging({ withVideo })
    ringTimeoutRef.current = setTimeout(() => {
      ringTimeoutRef.current = null
      gateway.sendCallSignal({ channelId, type: "cancel" })
      setRinging(null)
    }, 30_000)
  }, [channelId, currentUserName, gateway])

  const cancelCall = useCallback(() => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
    gateway.sendCallSignal({ channelId, type: "cancel" })
    setRinging(null)
  }, [channelId, gateway])

  const acceptCall = useCallback((withVideo: boolean) => {
    gateway.sendCallSignal({ channelId, type: "accept", withVideo })
    setIncomingCall(null)
    setActiveCall({ withVideo })
  }, [channelId, gateway])

  const declineCall = useCallback(() => {
    gateway.sendCallSignal({ channelId, type: "decline" })
    setIncomingCall(null)
  }, [channelId, gateway])

  const endCall = useCallback(() => {
    setActiveCall(null)
  }, [])

  return { incomingCall, activeCall, ringing, startCall, cancelCall, acceptCall, declineCall, endCall }
}
