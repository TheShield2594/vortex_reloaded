"use client"

/**
 * DM Voice/Video Call signaling helpers.
 *
 * Architecture:
 * - Caller clicks Phone/Video button → broadcasts "call-invite" via Supabase Realtime
 * - Callee sees incoming call toast → accepts (broadcasts "call-accepted") or declines
 * - Both sides enter the call screen (see DMCallView in dm-channel-area.tsx — WebRTC
 *   P2P / full-mesh via the shared `dm-call:{channelId}` signaling channel)
 * - Either party can hang up (broadcasts "call-hangup" / leaves the mesh)
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { Phone, PhoneOff, Video, Loader2 } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
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

/** Manages incoming/outgoing DM call state and signaling via Supabase Realtime broadcast. */
export function useDMCall(channelId: string, currentUserId: string, currentUserName: string) {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [activeCall, setActiveCall] = useState<{ withVideo: boolean } | null>(null)
  const [ringing, setRinging] = useState<{ withVideo: boolean } | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const incomingCallRef = useRef(incomingCall)
  incomingCallRef.current = incomingCall
  const ringingRef = useRef(ringing)
  ringingRef.current = ringing
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const ch = supabase.channel(`dm-call-notify:${channelId}`)
    channelRef.current = ch

    ch.on("broadcast", { event: "call-invite" }, ({ payload }) => {
      if (payload.callerId === currentUserId) return
      setIncomingCall({
        callerId: payload.callerId,
        callerName: payload.callerName,
        callerAvatar: payload.callerAvatar ?? null,
        channelId,
        withVideo: payload.withVideo ?? false,
      })
    })
    .on("broadcast", { event: "call-cancelled" }, ({ payload }) => {
      if (incomingCallRef.current?.callerId === payload.callerId) setIncomingCall(null)
    })
    .on("broadcast", { event: "call-accepted" }, ({ payload }) => {
      if (!ringingRef.current) return
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
      setRinging(null)
      setActiveCall({ withVideo: payload.acceptedWithVideo ?? false })
    })
    .on("broadcast", { event: "call-declined" }, () => {
      if (!ringingRef.current) return
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
      setRinging(null)
    })
    .subscribe()

    return () => {
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
      supabase.removeChannel(ch)
    }
  }, [channelId, currentUserId])

  const startCall = useCallback((withVideo: boolean, callerAvatar?: string | null) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "call-invite",
      payload: { callerId: currentUserId, callerName: currentUserName, callerAvatar: callerAvatar ?? null, withVideo },
    })
    setRinging({ withVideo })
    ringTimeoutRef.current = setTimeout(() => {
      ringTimeoutRef.current = null
      channelRef.current?.send({ type: "broadcast", event: "call-cancelled", payload: { callerId: currentUserId } })
      setRinging(null)
    }, 30_000)
  }, [currentUserId, currentUserName])

  const cancelCall = useCallback(() => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
    channelRef.current?.send({ type: "broadcast", event: "call-cancelled", payload: { callerId: currentUserId } })
    setRinging(null)
  }, [currentUserId])

  const acceptCall = useCallback((withVideo: boolean) => {
    channelRef.current?.send({ type: "broadcast", event: "call-accepted", payload: { acceptedWithVideo: withVideo } })
    setIncomingCall(null)
    setActiveCall({ withVideo })
  }, [])

  const declineCall = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "call-declined", payload: {} })
    setIncomingCall(null)
  }, [])

  const endCall = useCallback(() => {
    setActiveCall(null)
  }, [])

  return { incomingCall, activeCall, ringing, startCall, cancelCall, acceptCall, declineCall, endCall }
}
