"use client"

import { useCallback, useRef, useMemo } from "react"
import {
  useVoice,
  type NetworkQualityTier,
  type NetworkQualityStats,
  type ReconnectInfo,
} from "@/lib/webrtc/use-voice"
import { useLivekitVoice } from "@/lib/webrtc/use-livekit-voice"
import { type VoiceAudioSettings } from "@/lib/voice/audio-settings"
import { useVoiceAudioStore } from "@/lib/stores/voice-audio-store"

/** Build-time flag — truthy when NEXT_PUBLIC_LIVEKIT_URL is set. */
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

// ── LiveKit SFU adapter ──────────────────────────────────────────────────────

/**
 * Wraps useLivekitVoice and adapts its return value to the same interface as
 * useVoice so that VoiceChannel can consume either path identically.
 *
 * Fields that the LiveKit SFU path does not yet expose (screen share, CPU
 * bypass) are stubbed with sensible defaults or no-ops.  They can be promoted
 * to real implementations once the LiveKit hook is extended.
 *
 * EQ, gain, and spatial settings are persisted via the shared voice-audio-store
 * so changes made in the settings panel are preserved across sessions.
 */
function useVoiceViaLivekit(
  channelId: string,
  userId: string,
  serverId?: string | null,
): ReturnType<typeof useVoice> {
  // Stable null refs — VoiceChannel passes these to VortexRecap and the
  // local participant tile.  Null is safe; both consumers handle a null stream.
  const nullLocalStreamRef = useRef<MediaStream | null>(null)
  const nullCameraStreamRef = useRef<MediaStream | null>(null)

  // Screen stream ref is kept in sync with the LiveKit screen track below.
  const screenStreamRef = useRef<MediaStream | null>(null)

  // Persist MediaStream instances across renders to avoid re-mounting audio
  // elements every time a participant state field (speaking, muted) changes.
  const streamCacheRef = useRef(new Map<string, MediaStream>())

  const lk = useLivekitVoice({
    channelId,
    serverId: serverId ?? "",
    userId,
    enabled: !!channelId,
  })

  // Build a Map<peerId, PeerState>-compatible map from LiveKit participants.
  // The map key is the LiveKit identity (userId) rather than an ephemeral
  // signaling peer ID — all downstream consumers use the userId field for
  // display and per-participant audio controls, so this is equivalent.
  const peers = useMemo(() => {
    const map = new Map<string, {
      stream: MediaStream
      speaking: boolean
      muted: boolean
      userId: string
    }>()
    const seen = new Set<string>()

    for (const [uid, p] of lk.participants) {
      seen.add(uid)

      // Reuse the cached stream so downstream audio/video elements aren't
      // re-created on every speaking/muted state change.
      let stream = streamCacheRef.current.get(uid)
      if (!stream) {
        stream = new MediaStream()
        streamCacheRef.current.set(uid, stream)
      }

      // Sync tracks by MediaStreamTrack.id to avoid duplicates or stale refs.
      const currentById = new Map(stream.getTracks().map((t) => [t.id, t]))
      const desired = [p.audioTrack, p.cameraTrack].filter(
        (t): t is MediaStreamTrack => t !== null,
      )
      const desiredIds = new Set(desired.map((t) => t.id))

      for (const [id, t] of currentById) {
        if (!desiredIds.has(id)) stream.removeTrack(t)
      }
      for (const t of desired) {
        if (!currentById.has(t.id)) stream.addTrack(t)
      }

      map.set(uid, { stream, speaking: p.speaking, muted: p.muted, userId: uid })
    }

    // Evict streams for participants who have left the room.
    for (const uid of [...streamCacheRef.current.keys()]) {
      if (!seen.has(uid)) streamCacheRef.current.delete(uid)
    }

    return map
  }, [lk.participants])

  // Sync the screen stream ref with LiveKit's screen track.
  // We keep a single MediaStream in the ref and swap its track on changes.
  if (lk.screenTrack) {
    if (!screenStreamRef.current) {
      screenStreamRef.current = new MediaStream([lk.screenTrack])
    } else {
      const existing = screenStreamRef.current.getVideoTracks()
      if (existing.length === 0 || existing[0]!.id !== lk.screenTrack.id) {
        existing.forEach((t) => screenStreamRef.current!.removeTrack(t))
        screenStreamRef.current.addTrack(lk.screenTrack)
      }
    }
  } else {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => screenStreamRef.current!.removeTrack(t))
      screenStreamRef.current = null
    }
  }

  // Derive a ReconnectInfo from LiveKit's connected/connecting booleans.
  const reconnectInfo = useMemo<ReconnectInfo>(() => {
    if (lk.connecting) return { state: "reconnecting", attempt: 1, maxAttempts: 3 }
    if (!lk.connected) return { state: "disconnected", attempt: 0, maxAttempts: 3 }
    return { state: "connected", attempt: 0, maxAttempts: 3 }
  }, [lk.connected, lk.connecting])

  // Read EQ/gain/spatial settings from the persisted Zustand store so that the
  // LiveKit path shares the same settings surface as the P2P path.
  const profileSettings = useVoiceAudioStore((state) => state.profilesByUser[userId])
  const serverOverrideSettings = useVoiceAudioStore((state) =>
    serverId ? state.serverOverridesByUser[userId]?.[serverId] : undefined
  )
  const setProfileSettings = useVoiceAudioStore((state) => state.setProfileSettings)
  const setServerOverride = useVoiceAudioStore((state) => state.setServerOverride)

  const audioSettings = useMemo(() => {
    if (serverOverrideSettings) return serverOverrideSettings
    if (profileSettings) return profileSettings
    return useVoiceAudioStore.getState().getEffectiveSettings(userId, serverId)
  }, [profileSettings, serverOverrideSettings, userId, serverId])

  const setAudioSettings = useCallback((settings: VoiceAudioSettings) => {
    if (serverId) setServerOverride(userId, serverId, settings)
    else setProfileSettings(userId, settings)
  }, [serverId, userId, setProfileSettings, setServerOverride])

  return {
    peers,
    muted: lk.muted,
    deafened: lk.deafened,
    speaking: lk.speaking,
    screenSharing: lk.screenShareEnabled,
    videoEnabled: lk.videoEnabled,
    // LiveKit toggleMute is async; fire-and-forget to match () => void signature.
    toggleMute: () => { lk.toggleMute().catch(() => {}) },
    toggleDeafen: lk.toggleDeafen,
    toggleScreenShare: lk.toggleScreenShare,
    toggleVideo: lk.toggleVideo,
    leaveChannel: lk.leave,
    localStream: nullLocalStreamRef,
    screenStream: screenStreamRef,
    cameraStream: nullCameraStreamRef,
    audioInputDevices: lk.audioInputDevices,
    audioOutputDevices: lk.audioOutputDevices,
    selectedInputId: lk.selectedInputId,
    selectedOutputId: lk.selectedOutputId,
    setSelectedInputId: (id: string | null) => { if (id) lk.setInputDevice(id).catch(() => {}) },
    setSelectedOutputId: (id: string | null) => { if (id) lk.setOutputDevice(id).catch(() => {}) },
    audioSettings,
    setAudioSettings,
    cpuBypassActive: false,
    audioInitError: lk.error,
    isPermissionError: lk.error?.toLowerCase().includes("denied") ?? false,
    retryAudioInit: noop,
    networkQuality: null,
    reconnectInfo,
    manualReconnect: noop,
  }
}

// ── Raw WebRTC P2P pass-through ───────────────────────────────────────────────

function useVoiceViaP2P(
  channelId: string,
  userId: string,
  serverId?: string | null,
): ReturnType<typeof useVoice> {
  return useVoice(channelId, userId, serverId)
}

// ── Unified export ────────────────────────────────────────────────────────────

/**
 * useUnifiedVoice — single entrypoint for all voice functionality.
 *
 * Delegates to the LiveKit SFU path when NEXT_PUBLIC_LIVEKIT_URL is set at
 * build time, otherwise falls back to the raw RTCPeerConnection / Supabase
 * Realtime P2P path.
 *
 * The selection is a module-level constant assignment so the same concrete
 * function is always called during a session — hook call order is stable
 * across renders and complies with React's Rules of Hooks.
 */
export const useUnifiedVoice: typeof useVoiceViaP2P = LIVEKIT_URL
  ? (useVoiceViaLivekit as typeof useVoiceViaP2P)
  : useVoiceViaP2P

// Re-export shared types so callers don't need to import from use-voice directly.
export type { NetworkQualityTier, NetworkQualityStats, ReconnectInfo }
