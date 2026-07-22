"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import { useRouter } from "next/navigation"
import {
  Volume2, Mic, MicOff, Headphones, PhoneOff,
  Monitor, MonitorOff, Video, VideoOff, Radio, Settings,
  RotateCcw, X, RefreshCw, WifiOff,
} from "lucide-react"
import { useUnifiedVoice, type NetworkQualityTier, type NetworkQualityStats } from "@/lib/webrtc/use-unified-voice"
import { usePushToTalk } from "@/hooks/use-push-to-talk"
import { useAppStore } from "@/lib/stores/app-store"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { UserRow } from "@/types/database"
import { cn } from "@/lib/utils/cn"
import {
  applyPresetToSettings,
  createDefaultAudioSettings,
  withEqBandGain,
  type AudioPreset,
  type VoiceAudioSettings,
} from "@/lib/voice/audio-settings"
import { useVoiceAudioStore } from "@/lib/stores/voice-audio-store"
import { useShallow } from "zustand/react/shallow"
import { useVortexRecap } from "@/lib/voice/use-vortex-recap"
import { VortexRecapIndicator } from "@/components/voice/vortex-recap-indicator"
import { VoiceConsentModal } from "@/components/voice/voice-consent-modal"
import { VoiceTranscriptViewer } from "@/components/voice/voice-transcript-viewer"
import { VoiceStatsOverlay, VoiceStatsToggle } from "@/components/voice/voice-stats-overlay"
import { VoiceGridLayout } from "@/components/voice/voice-grid-layout"
import { useDeviceMonitoring } from "@/hooks/use-device-monitoring"

interface VoiceParticipantInfo {
  user: UserRow
  selfStream: boolean
}

type VoiceSessionTone = "stable" | "listening" | "attention"

const TONE_STYLES: Record<VoiceSessionTone, { dot: string; badgeBg: string; badgeText: string }> = {
  stable: { dot: "var(--theme-presence-offline)", badgeBg: "rgba(128,132,142,0.18)", badgeText: "#c9ccd1" },
  listening: { dot: "var(--theme-success)", badgeBg: "rgba(35,165,90,0.2)", badgeText: "#9ae6b4" },
  attention: { dot: "var(--theme-warning)", badgeBg: "rgba(240,177,50,0.2)", badgeText: "#ffd58a" },
}

/** Derive the voice session status label, detail text, and visual tone from current state. */
function getVoiceSessionState(peerCount: number, speaking: boolean, hasError: boolean): {
  label: string
  detail: string
  tone: VoiceSessionTone
} {
  if (hasError) {
    return {
      label: "Needs attention",
      detail: "Audio setup needs a quick fix",
      tone: "attention",
    }
  }
  if (speaking) {
    return {
      label: "Speaking",
      detail: "Your voice is being sent clearly",
      tone: "listening",
    }
  }
  if (peerCount === 0) {
    return {
      label: "Ready",
      detail: "Waiting for others to join",
      tone: "stable",
    }
  }

  return {
    label: "Connected",
    detail: `Listening with ${peerCount} ${peerCount === 1 ? "person" : "people"}`,
    tone: "stable",
  }
}

interface Props {
  channelId: string
  channelName: string
  serverId: string
  currentUserId: string
  isStage?: boolean
  stageStreamUrl?: string | null
  canConnect?: boolean
  canSpeak?: boolean
  canModerate?: boolean
}

function toYoutubeEmbedUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.replace(/^www\./, "")
    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = parsed.searchParams.get("v")
      if (!videoId) return null
      return `https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1&rel=0`
    }
    if (host === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0]
      if (!videoId) return null
      return `https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1&rel=0`
    }
  } catch {
    return null
  }

  return null
}

const MAX_REMOTE_GAIN = 2

const PRESET_OPTIONS: Array<{ label: string; value: AudioPreset }> = [
  { label: "Voice Clarity", value: "voice-clarity" },
  { label: "Bass Boost", value: "bass-boost" },
  { label: "Broadcast", value: "broadcast" },
  { label: "Flat", value: "flat" },
]

/** Merge partial overrides into audio settings and reset the preset to "flat". */
function markCustomSettings(settings: VoiceAudioSettings, partial: Partial<VoiceAudioSettings>): VoiceAudioSettings {
  return { ...settings, ...partial, preset: "flat" }
}

/** Main voice channel view with participant grid, spotlight mode, and media controls. */
export function VoiceChannel({ channelId, channelName, serverId, currentUserId, isStage = false, stageStreamUrl = null, canConnect = true, canSpeak = true, canModerate = false }: Props) {
  const { currentUser, setVoiceChannel, channels } = useAppStore(
    useShallow((s) => ({ currentUser: s.currentUser, setVoiceChannel: s.setVoiceChannel, channels: s.channels }))
  )
  const router = useRouter()
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipantInfo[]>([])
  const [spotlightUserId, setSpotlightUserId] = useState<string | null>(null)
  const [pttEnabled, setPttEnabled] = useState(false)
  const supabaseRef = useRef<ReturnType<typeof createClientSupabaseClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClientSupabaseClient()
  const supabase = supabaseRef.current
  const voiceSubIdRef = useRef(0)

  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false)
  const [statsOverlayOpen, setStatsOverlayOpen] = useState(false)
  const [rttHistory, setRttHistory] = useState<number[]>([])
  const [lossHistory, setLossHistory] = useState<number[]>([])
  const outputAudioContextRef = useRef<AudioContext | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const closeDeviceMenu = useCallback(() => setDeviceMenuOpen(false), [])
  const {
    peers,
    muted,
    deafened,
    speaking,
    screenSharing,
    videoEnabled,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    toggleVideo,
    leaveChannel,
    localStream,
    screenStream,
    cameraStream,
    audioInputDevices,
    audioOutputDevices,
    selectedInputId,
    selectedOutputId,
    setSelectedInputId,
    setSelectedOutputId,
    audioSettings,
    setAudioSettings,
    cpuBypassActive,
    audioInitError,
    isPermissionError,
    retryAudioInit,
    networkQuality,
    reconnectInfo,
    manualReconnect,
  } = useUnifiedVoice(channelId, currentUserId, serverId)

  const { setParticipantVolume, setParticipantPan } = useVoiceAudioStore(
    useShallow((s) => ({ setParticipantVolume: s.setParticipantVolume, setParticipantPan: s.setParticipantPan }))
  )

  // Sync voice controls to global store for CompactVoiceBar
  const setVoiceControls = useAppStore((s) => s.setVoiceControls)
  useEffect(() => {
    setVoiceControls({
      muted,
      deafened,
      reconnectInfo: reconnectInfo,
      toggleMute,
      toggleDeafen,
      manualReconnect,
    })
  }, [muted, deafened, reconnectInfo, toggleMute, toggleDeafen, manualReconnect, setVoiceControls])

  const pttActivate = useCallback(() => { if (muted) toggleMute() }, [muted, toggleMute])
  const pttDeactivate = useCallback(() => { if (!muted) toggleMute() }, [muted, toggleMute])
  usePushToTalk(pttEnabled, pttActivate, pttDeactivate)

  // ── Voice Intelligence ────────────────────────────────────────────────────
  const {
    session: viSession,
    policy: viPolicy,
    myConsent: viConsent,
    participantConsents: viParticipantConsents,
    transcriptionStatus: viTranscriptionStatus,
    interimSegment: viInterimSegment,
    finalSegments: viFinalSegments,
    summaryPending: viSummaryPending,
    startSession: viStartSession,
    setConsent: viSetConsent,
    endSession: viEndSession,
  } = useVortexRecap(currentUserId)

  const [showConsentModal, setShowConsentModal] = useState(false)

  // Start the voice intelligence session after the component mounts.
  // Non-fatal: voice continues to work if this fails.
  useEffect(() => {
    viStartSession({
      scopeType: "server_channel",
      scopeId: `${serverId}:${channelId}`,
      localStream: localStream.current,
      language: "en-US",
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Show consent modal once we know the policy requires it.
  useEffect(() => {
    if (viSession && viPolicy?.transcriptionEnabled && viPolicy.requireExplicitConsent) {
      setShowConsentModal(true)
    }
  }, [viSession, viPolicy])

  // End intelligence session on unmount.
  useEffect(() => {
    return () => {
      viEndSession().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build display-name map for consent badges and transcript attribution.
  const viParticipantNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of voiceParticipants) {
      map.set(p.user.id, p.user.display_name ?? p.user.username)
    }
    return map
  }, [voiceParticipants])
  // ── End Voice Intelligence ────────────────────────────────────────────────

  // ── Device Monitoring ──────────────────────────────────────────────────
  const { prompt: devicePrompt, dismiss: dismissDevicePrompt } = useDeviceMonitoring()

  // ── Network Stats History ──────────────────────────────────────────────
  useEffect(() => {
    if (!networkQuality) return
    setRttHistory((prev) => [...prev.slice(-29), networkQuality.rttMs])
    setLossHistory((prev) => [...prev.slice(-29), networkQuality.packetLossPercent])
  }, [networkQuality])

  useEffect(() => {
    return () => {
      if (outputAudioContextRef.current) {
        outputAudioContextRef.current.close().catch(() => undefined)
        outputAudioContextRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    async function joinVoiceState() {
      await supabase
        .from("voice_states")
        .upsert({
          user_id: currentUserId,
          channel_id: channelId,
          server_id: serverId,
          muted,
          deafened,
          speaking,
          self_stream: screenSharing,
        })
    }
    joinVoiceState()

    return () => {
      supabase.from("voice_states").delete().eq("user_id", currentUserId).eq("channel_id", channelId).then(undefined, () => {})
    }
  }, [channelId, currentUserId, serverId])

  useEffect(() => {
    supabase
      .from("voice_states")
      .update({ muted, deafened, speaking, self_stream: screenSharing })
      .eq("user_id", currentUserId)
      .eq("channel_id", channelId)
      .then(undefined, () => {})
  }, [muted, deafened, speaking, screenSharing])

  useEffect(() => {
    interface VoiceStateWithUser {
      user_id: string
      self_stream: boolean | null
      users: UserRow | null
    }

    async function fetchParticipants() {
      try {
        const { data, error } = await supabase.from("voice_states").select("user_id, self_stream, users(*)").eq("channel_id", channelId)
        if (error) {
          console.error("[voice-channel] fetchParticipants failed:", error.message)
          return
        }
        // The join type generated by Supabase doesn't reflect the actual runtime
        // shape (users row nested under `users` key), so we cast through unknown.
        const rows = (data ?? []) as unknown as VoiceStateWithUser[]
        setVoiceParticipants(
          rows.flatMap((d) =>
            d.users ? [{ user: d.users, selfStream: Boolean(d.self_stream) }] : []
          )
        )
      } catch (err) {
        console.error("[voice-channel] fetchParticipants error:", err)
      }
    }
    fetchParticipants()

    const vcSubId = ++voiceSubIdRef.current
    const channel = supabase
      .channel(`voice:${channelId}:${vcSubId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "voice_states", filter: `channel_id=eq.${channelId}`,
      }, fetchParticipants)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [channelId])

  // Refs for latest voice state values (used in reconnect effect to avoid stale closures)
  const mutedRef = useRef(muted)
  const deafenedRef = useRef(deafened)
  const speakingRef = useRef(speaking)
  const screenSharingRef = useRef(screenSharing)
  mutedRef.current = muted
  deafenedRef.current = deafened
  speakingRef.current = speaking
  screenSharingRef.current = screenSharing

  // Network recovery and voice state re-sync on reconnect
  useEffect(() => {
    if (reconnectInfo.state !== "connected") return
    // Re-upsert voice state when connection is restored (handles network recovery scenarios)
    supabase
      .from("voice_states")
      .upsert({
        user_id: currentUserId,
        channel_id: channelId,
        server_id: serverId,
        muted: mutedRef.current,
        deafened: deafenedRef.current,
        speaking: speakingRef.current,
        self_stream: screenSharingRef.current,
      })
      .then(undefined, () => {})
  // Only run when connection state transitions to "connected"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectInfo.state])

  function handleLeave() {
    viEndSession().catch(() => {})
    leaveChannel()
    setVoiceChannel(null, null)
    const serverChannels = channels[serverId] ?? []
    const textChannel = serverChannels
      .filter((c) => c.type === "text")
      .sort((a, b) => a.position - b.position)[0]
    router.push(textChannel ? `/channels/${serverId}/${textChannel.id}` : `/channels/${serverId}`)
  }

  const peerArray = useMemo(() => peers ? Array.from(peers.entries()) : [], [peers])
  const hasVideo = videoEnabled || screenSharing || peerArray.some(([, { stream }]) => stream.getVideoTracks().length > 0)
  const participantsByUserId = useMemo(() => {
    const map = new Map<string, VoiceParticipantInfo>()
    for (const p of voiceParticipants) map.set(p.user.id, p)
    return map
  }, [voiceParticipants])

  useEffect(() => {
    if (!spotlightUserId) return
    if (spotlightUserId === currentUserId && !screenSharing) {
      setSpotlightUserId(null)
      return
    }
    if (spotlightUserId !== currentUserId) {
      const peerInfo = participantsByUserId.get(spotlightUserId)
      if (peerInfo && !peerInfo.selfStream) {
        setSpotlightUserId(null)
        return
      }
      const stillConnected = peers && Array.from(peers.values()).some((p) => p.userId === spotlightUserId)
      if (!stillConnected) {
        setSpotlightUserId(null)
      }
    }
  }, [spotlightUserId, currentUserId, screenSharing, participantsByUserId, peers])
  const sessionState = getVoiceSessionState(peerArray.length, speaking && !muted, Boolean(audioInitError))
  const activeTone = TONE_STYLES[sessionState.tone]
  const stageEmbedUrl = useMemo(() => toYoutubeEmbedUrl(stageStreamUrl), [stageStreamUrl])

  const isLocalSpotlight = spotlightUserId === currentUserId
  const spotlightPeer = spotlightUserId && !isLocalSpotlight
    ? peerArray.find(([, { userId }]) => userId === spotlightUserId)
    : null
  const inSpotlight = spotlightUserId !== null

  let spotlightStream: MediaStream | null = null
  let spotlightDisplayName = ""
  if (isLocalSpotlight) {
    spotlightStream = screenStream.current
    spotlightDisplayName = currentUser?.display_name || currentUser?.username || "You"
  } else if (spotlightPeer) {
    const [, { stream: peerStream, userId }] = spotlightPeer
    spotlightStream = peerStream
    const info = participantsByUserId.get(userId)
    spotlightDisplayName = info?.user.display_name || info?.user.username || "Unknown"
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col flex-1" style={{ background: "var(--theme-bg-primary)" }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
          <Volume2 className="w-5 h-5" style={{ color: "var(--theme-success)" }} />
          <span className="font-semibold text-white">{channelName}</span>
          <div className="ml-1 flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: activeTone.badgeBg, color: activeTone.badgeText }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: activeTone.dot }} />
              {sessionState.label}
            </span>
            {reconnectInfo.state === "reconnecting" && (
              <span className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: "color-mix(in srgb, var(--theme-warning) 20%, transparent)", color: "var(--theme-warning)" }} role="status" aria-live="polite" aria-atomic="true">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Reconnecting... ({reconnectInfo.attempt}/{reconnectInfo.maxAttempts})
              </span>
            )}
            {reconnectInfo.state === "disconnected" && (
              <span className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: "color-mix(in srgb, var(--theme-danger) 20%, transparent)", color: "var(--theme-danger)" }} role="status" aria-live="assertive" aria-atomic="true">
                <WifiOff className="w-3 h-3" />
                Connection lost
                <button
                  type="button"
                  onClick={manualReconnect}
                  className="ml-1 underline hover:no-underline"
                >
                  Rejoin
                </button>
              </span>
            )}
            <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{sessionState.detail}</span>
          </div>
          {/* Voice intelligence status badges */}
          <VortexRecapIndicator
            transcriptionStatus={viTranscriptionStatus}
            summaryPending={viSummaryPending}
            participantConsents={viParticipantConsents}
            participantNames={viParticipantNames}
          />
          <div className="ml-auto flex items-center gap-2 relative">
            <NetworkQualityIndicator quality={networkQuality} />
            <VoiceStatsToggle quality={networkQuality} onClick={() => setStatsOverlayOpen((v) => !v)} />
            <VoiceStatsOverlay
              quality={networkQuality}
              rttHistory={rttHistory}
              lossHistory={lossHistory}
              peerCount={peerArray.length}
              open={statsOverlayOpen}
              onToggle={() => setStatsOverlayOpen(false)}
            />
            {cpuBypassActive && <span className="text-xs" style={{ color: "var(--theme-warning)" }}>CPU bypass enabled</span>}
            {audioInitError && (
              <MediaPermissionRecovery
                message={audioInitError}
                isPermissionError={isPermissionError}
                onRetry={retryAudioInit}
              />
            )}
          </div>
        </div>

        {/* Scrollable content area — keeps bottom toolbar always visible */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">

        {isStage && (
          <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)" }}>
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-0.5 rounded-full" style={{ background: canSpeak ? "rgba(35,165,90,0.2)" : "rgba(128,132,142,0.2)", color: canSpeak ? "#9ae6b4" : "#c9ccd1" }}>
                {canSpeak ? "Speaker" : "Audience"}
              </span>
              {!canSpeak && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(88,101,242,0.2)", color: "#dbe2ff" }}>Request to speak available</span>
              )}
              {canModerate && (
                <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(240,177,50,0.2)", color: "#ffd58a" }}>Stage moderator controls enabled</span>
              )}
            </div>
            {!canSpeak && (
              <button
                type="button"
                className="mb-2 text-xs px-2 py-1 rounded"
                style={{ background: "var(--theme-accent)", color: "white" }}
              >
                Request to Speak
              </button>
            )}
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-secondary)" }}>
              Stage Stream
            </p>
            {stageEmbedUrl ? (
              <div className="mt-2 rounded-md overflow-hidden border" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
                <iframe
                  title="Stage YouTube stream"
                  src={stageEmbedUrl}
                  className="w-full"
                  style={{ height: 220 }}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
                No YouTube stream is configured for this Stage channel yet.
              </p>
            )}
          </div>
        )}

        {inSpotlight ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 relative flex items-center justify-center overflow-hidden" style={{ background: "var(--theme-bg-tertiary)" }}>
              <button
                type="button"
                aria-label="Close spotlight"
                onClick={() => setSpotlightUserId(null)}
                className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
                style={{ background: "rgba(0,0,0,0.6)" }}
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2.5 py-1 rounded-md" style={{ background: "rgba(0,0,0,0.6)" }}>
                <Monitor className="w-3.5 h-3.5" style={{ color: "var(--theme-success)" }} />
                <span className="text-xs text-white">{spotlightDisplayName}&apos;s Screen</span>
              </div>
              <SpotlightVideo stream={spotlightStream} />
            </div>
            <div className="flex gap-2 px-4 py-3 overflow-x-auto flex-shrink-0" style={{ background: "var(--theme-bg-secondary)", borderTop: "1px solid var(--theme-bg-tertiary)" }}>
              {currentUser && (
                <div className="w-48 flex-shrink-0 min-w-0">
                  <ParticipantTile
                    user={currentUser}
                    speaking={speaking}
                    muted={muted}
                    deafened={deafened}
                    audioStream={localStream.current}
                    cameraStream={videoEnabled ? cameraStream.current : null}
                    screenStream={screenSharing ? screenStream.current : null}
                    isLocal
                    compact
                    onViewStream={screenSharing && spotlightUserId !== currentUserId ? () => setSpotlightUserId(currentUserId) : undefined}
                  />
                </div>
              )}
              {peerArray.map(([peerId, { stream, speaking: pSpeaking, muted: pMuted, userId }]) => (
                <PeerTileWrapper
                  key={peerId}
                  peerId={peerId}
                  stream={stream}
                  speaking={pSpeaking}
                  muted={pMuted}
                  userId={userId}
                  participantsByUserId={participantsByUserId}
                  serverId={serverId}
                  spotlightUserId={spotlightUserId}
                  setSpotlightUserId={setSpotlightUserId}
                  compact
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4 md:p-8">
            {peerArray.length === 0 && !currentUser ? (
              <div className="text-center">
                <Volume2 className="w-16 h-16 mx-auto mb-4" style={{ color: "var(--theme-text-faint)" }} />
                <p className="text-white text-lg font-semibold mb-1">You&apos;re the only one here</p>
                <p style={{ color: "var(--theme-text-muted)" }} className="text-sm">Invite others to join this voice channel</p>
              </div>
            ) : (
              <VoiceGridLayout participantCount={peerArray.length + (currentUser ? 1 : 0)} hasVideo={hasVideo}>
                {currentUser && (
                  <ParticipantTile
                    user={currentUser}
                    speaking={speaking}
                    muted={muted}
                    deafened={deafened}
                    audioStream={localStream.current}
                    cameraStream={videoEnabled ? cameraStream.current : null}
                    screenStream={screenSharing ? screenStream.current : null}
                    isLocal
                    onViewStream={screenSharing ? () => setSpotlightUserId(currentUserId) : undefined}
                  />
                )}
                {peerArray.map(([peerId, { stream, speaking: pSpeaking, muted: pMuted, userId }]) => (
                  <PeerTileWrapper
                    key={peerId}
                    peerId={peerId}
                    stream={stream}
                    speaking={pSpeaking}
                    muted={pMuted}
                    userId={userId}
                    participantsByUserId={participantsByUserId}
                    serverId={serverId}
                    spotlightUserId={spotlightUserId}
                    setSpotlightUserId={setSpotlightUserId}
                    setParticipantVolume={setParticipantVolume}
                    setParticipantPan={setParticipantPan}
                    spatialEnabled={audioSettings.spatialAudioEnabled}
                  />
                ))}
              </VoiceGridLayout>
            )}
          </div>
        )}

        {/* Live transcript viewer — only shown when the user has consented */}
        {viConsent?.consentTranscription && (
          <div className="px-4 py-2 border-t flex-shrink-0" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
            <VoiceTranscriptViewer
              finalSegments={viFinalSegments}
              interimSegment={viInterimSegment}
              participantNames={viParticipantNames}
            />
          </div>
        )}

        </div>{/* end scrollable content area */}

        <div className="min-h-16 md:min-h-20 flex-shrink-0 border-t relative" style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)", paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center justify-center gap-1 sm:gap-1.5 md:gap-3 px-1 sm:px-2 md:px-6 py-2 overflow-x-auto">
          <Tooltip><TooltipTrigger asChild><button onClick={toggleMute} disabled={!canConnect || (isStage && !canSpeak)} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: muted ? "var(--theme-danger)" : "var(--theme-text-faint)" }}>{muted ? <MicOff className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Mic className="w-4 h-4 md:w-5 md:h-5 text-white" />}</button></TooltipTrigger><TooltipContent>{muted ? "Unmute" : "Mute"}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><button onClick={toggleDeafen} aria-label={deafened ? "Undeafen" : "Deafen"} aria-pressed={deafened} className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors" style={{ background: deafened ? "var(--theme-danger)" : "var(--theme-text-faint)" }}><Headphones className="w-4 h-4 md:w-5 md:h-5 text-white" /></button></TooltipTrigger><TooltipContent>{deafened ? "Undeafen" : "Deafen"}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><button onClick={() => setPttEnabled((v) => !v)} aria-label={pttEnabled ? "Disable Push-to-Talk" : "Enable Push-to-Talk"} aria-pressed={pttEnabled} className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors" style={{ background: pttEnabled ? "var(--theme-accent)" : "var(--theme-text-faint)" }} title="Push-to-Talk (Space)"><Radio className="w-4 h-4 md:w-5 md:h-5 text-white" /></button></TooltipTrigger><TooltipContent>{pttEnabled ? "Disable PTT" : "Enable Push-to-Talk (Space)"}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><button onClick={toggleVideo} disabled={!canConnect || (isStage && !canSpeak)} aria-label={videoEnabled ? "Turn Off Camera" : "Turn On Camera"} aria-pressed={videoEnabled} className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: videoEnabled ? "var(--theme-success)" : "var(--theme-text-faint)" }}>{videoEnabled ? <Video className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <VideoOff className="w-4 h-4 md:w-5 md:h-5 text-white" />}</button></TooltipTrigger><TooltipContent>{videoEnabled ? "Turn Off Camera" : "Turn On Camera"}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><button onClick={toggleScreenShare} disabled={!canConnect || (isStage && !canSpeak)} aria-label={screenSharing ? "Stop Sharing Screen" : "Share Screen"} aria-pressed={screenSharing} className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: screenSharing ? "var(--theme-success)" : "var(--theme-text-faint)" }}>{screenSharing ? <MonitorOff className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Monitor className="w-4 h-4 md:w-5 md:h-5 text-white" />}</button></TooltipTrigger><TooltipContent>{screenSharing ? "Stop Sharing" : "Share Screen"}</TooltipContent></Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={settingsButtonRef}
                onClick={() => setDeviceMenuOpen((v) => !v)}
                aria-label="Audio Settings"
                aria-expanded={deviceMenuOpen}
                className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors"
                style={{ background: deviceMenuOpen ? "var(--theme-accent)" : "var(--theme-text-faint)" }}
              >
                <Settings className="w-4 h-4 md:w-5 md:h-5 text-white" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Audio Settings</TooltipContent>
          </Tooltip>

          <Tooltip><TooltipTrigger asChild><button onClick={handleLeave} aria-label="Disconnect" className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-colors" style={{ background: "var(--theme-danger)" }}><PhoneOff className="w-4 h-4 md:w-5 md:h-5 text-white" /></button></TooltipTrigger><TooltipContent>Disconnect</TooltipContent></Tooltip>
          </div>

          {/* Settings panel rendered outside the scrollable button row to avoid overflow clipping */}
          {deviceMenuOpen && (
            <VoiceSettingsPanel
              audioInputDevices={audioInputDevices}
              audioOutputDevices={audioOutputDevices}
              selectedInputId={selectedInputId}
              selectedOutputId={selectedOutputId}
              setSelectedInputId={setSelectedInputId}
              setSelectedOutputId={setSelectedOutputId}
              settings={audioSettings}
              setSettings={setAudioSettings}
              onClose={closeDeviceMenu}
              settingsButtonRef={settingsButtonRef}
            />
          )}
        </div>

        {peerArray.map(([peerId, { stream, userId }], idx) => (
          <ReactiveRemoteAudio
            key={peerId}
            serverId={serverId}
            userId={userId}
            stream={stream}
            deafened={deafened}
            outputDeviceId={selectedOutputId}
            outputGain={audioSettings.outputGain}
            spatialEnabled={audioSettings.spatialAudioEnabled}
            peerIndex={idx}
            sharedAudioContextRef={outputAudioContextRef}
          />
        ))}
      </div>
      {/* New device detected prompt */}
      {devicePrompt && (
        <div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
          role="alert"
        >
          <span className="text-sm text-white">
            New {devicePrompt.kind === "audioinput" ? "microphone" : "speaker"} detected:{" "}
            <strong>{devicePrompt.device.label || "Unknown Device"}</strong>
          </span>
          <button
            onClick={() => {
              if (devicePrompt.kind === "audioinput") {
                setSelectedInputId(devicePrompt.device.deviceId)
              } else {
                setSelectedOutputId(devicePrompt.device.deviceId)
              }
              dismissDevicePrompt()
            }}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-white"
            style={{ background: "var(--theme-accent)" }}
          >
            Switch
          </button>
          <button
            onClick={dismissDevicePrompt}
            className="text-xs px-2 py-1.5 rounded-lg"
            style={{ color: "var(--theme-text-muted)" }}
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Consent modal — shown when the server policy requires explicit opt-in */}
      {showConsentModal && (
        <VoiceConsentModal
          isDmCall={false}
          onAccept={(consentTranscription, consentTranslation, subtitleLanguage) => {
            setShowConsentModal(false)
            viSetConsent(consentTranscription, consentTranslation, subtitleLanguage).catch(() => {})
          }}
          onDecline={() => {
            setShowConsentModal(false)
            viSetConsent(false, false, null).catch(() => {})
          }}
        />
      )}
    </TooltipProvider>
  )
}

/** Three-bar network quality indicator (green/yellow/red). */
const QUALITY_COLORS: Record<NetworkQualityTier, string> = {
  good: "var(--theme-success)",
  degraded: "var(--theme-warning)",
  poor: "var(--theme-danger)",
}

const QUALITY_LABELS: Record<NetworkQualityTier, string> = {
  good: "Good",
  degraded: "Unstable",
  poor: "Poor",
}

/** Recovery banner shown when microphone or camera permission is denied or audio init fails. */
function MediaPermissionRecovery({
  message,
  isPermissionError,
  onRetry,
}: {
  message: string
  isPermissionError: boolean
  onRetry: () => void
}): React.ReactElement {
  return (
    <div
      className="flex flex-col gap-2 rounded-md px-3 py-2 text-xs"
      style={{
        background: "rgba(240,70,70,0.12)",
        border: "1px solid rgba(240,70,70,0.25)",
        color: "var(--theme-text-primary)",
      }}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <MicOff size={14} style={{ color: "var(--theme-error)", flexShrink: 0 }} />
        <span>{message}</span>
      </div>

      {isPermissionError && (
        <span style={{ color: "var(--theme-text-secondary)" }}>
          Click the lock icon in your browser&apos;s address bar to reset site permissions, then retry.
        </span>
      )}

      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs font-medium transition-colors"
        style={{
          background: "var(--theme-bg-tertiary)",
          color: "var(--theme-text-primary)",
        }}
      >
        <RefreshCw size={12} />
        Retry
      </button>
    </div>
  )
}

function NetworkQualityIndicator({ quality }: { quality: NetworkQualityStats | null }) {
  if (!quality) return null

  const color = QUALITY_COLORS[quality.tier]
  const label = QUALITY_LABELS[quality.tier]
  // 3 bars: bar 1 always lit, bar 2 lit for good/degraded, bar 3 lit for good only
  const bars = quality.tier === "good" ? 3 : quality.tier === "degraded" ? 2 : 1

  const tooltipText = [
    `Network: ${label}`,
    `RTT: ${quality.rttMs}ms`,
    `Loss: ${quality.packetLossPercent}%`,
    `Jitter: ${quality.jitterMs}ms`,
    quality.availableBitrateKbps !== null ? `Bitrate: ${quality.availableBitrateKbps} kbps` : null,
  ].filter(Boolean).join(" | ")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-end gap-[2px] h-4 cursor-default"
          role="status"
          aria-label={`Network quality: ${label}`}
        >
          {[1, 2, 3].map((bar) => (
            <div
              key={bar}
              className="rounded-sm transition-colors duration-300"
              style={{
                width: "4px",
                height: `${bar * 4 + 2}px`,
                background: bar <= bars ? color : "var(--theme-text-faint)",
                opacity: bar <= bars ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Floating panel for audio device selection, EQ, gain, and spatial settings. */
function VoiceSettingsPanel({
  audioInputDevices,
  audioOutputDevices,
  selectedInputId,
  selectedOutputId,
  setSelectedInputId,
  setSelectedOutputId,
  settings,
  setSettings,
  onClose,
  settingsButtonRef,
}: {
  audioInputDevices: MediaDeviceInfo[]
  audioOutputDevices: MediaDeviceInfo[]
  selectedInputId: string | null
  selectedOutputId: string | null
  setSelectedInputId: (id: string | null) => void
  setSelectedOutputId: (id: string | null) => void
  settings: VoiceAudioSettings
  setSettings: (settings: VoiceAudioSettings) => void
  onClose: () => void
  settingsButtonRef?: React.RefObject<HTMLButtonElement | null>
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!panelRef.current || !target) return
      // If click was on the settings button, let the button's onClick handle the toggle
      if (settingsButtonRef?.current?.contains(target)) return
      if (!panelRef.current.contains(target)) onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, settingsButtonRef])

  return (
    <div ref={panelRef} className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-[360px] rounded-xl shadow-2xl p-4 space-y-4 z-50" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Voice Settings</p>
        <button
          onClick={() => setSettings(createDefaultAudioSettings())}
          className="text-xs px-2 py-1 rounded inline-flex items-center gap-1"
          style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>Profile</label>
        <select value={settings.preset} onChange={(e) => setSettings(applyPresetToSettings(e.target.value as AudioPreset, settings))} className="w-full px-2 py-1.5 rounded text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}>
          {PRESET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs mb-1" style={{ color: "var(--theme-text-secondary)" }}>Microphone (live preview)</label>
        <input type="range" min={0.2} max={2} step={0.01} value={settings.inputGain} onChange={(e) => setSettings(markCustomSettings(settings, { inputGain: Number(e.target.value) }))} className="w-full" />
      </div>
      <div>
        <label className="block text-xs mb-1" style={{ color: "var(--theme-text-secondary)" }}>Output gain</label>
        <input type="range" min={0.2} max={2} step={0.01} value={settings.outputGain} onChange={(e) => setSettings(markCustomSettings(settings, { outputGain: Number(e.target.value) }))} className="w-full" />
      </div>

      <div className="space-y-2">
        <label className="block text-xs" style={{ color: "var(--theme-text-secondary)" }}>EQ (6 bands)</label>
        <div className="grid grid-cols-3 gap-2">
          {settings.eqBands.map((band, idx) => (
            <div key={idx}>
              <p className="text-[10px]" style={{ color: "var(--theme-text-muted)" }}>{band.frequency}Hz</p>
              <input type="range" min={-12} max={12} step={0.5} value={band.gain} onChange={(e) => setSettings(withEqBandGain(settings, idx, Number(e.target.value)))} className="w-full" />
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between text-xs" style={{ color: "var(--theme-text-secondary)" }}>
        Bypass processing
        <input type="checkbox" checked={settings.bypassProcessing} onChange={(e) => setSettings({ ...settings, bypassProcessing: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-xs" style={{ color: "var(--theme-text-secondary)" }}>
        Auto bypass on CPU constraint
        <input type="checkbox" checked={settings.bypassOnCpuConstraint} onChange={(e) => setSettings({ ...settings, bypassOnCpuConstraint: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-xs" style={{ color: "var(--theme-text-secondary)" }}>
        Spatial pan
        <input type="checkbox" checked={settings.spatialAudioEnabled} onChange={(e) => setSettings({ ...settings, spatialAudioEnabled: e.target.checked })} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-semibold uppercase mb-1" style={{ color: "var(--theme-text-secondary)" }}>Microphone device</label>
          <select value={selectedInputId ?? ""} onChange={(e) => setSelectedInputId(e.target.value || null)} className="w-full px-2 py-1.5 rounded text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}>
            <option value="">Default</option>
            {audioInputDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 6)}`}</option>)}
          </select>
        </div>
        {audioOutputDevices.length > 0 && (
          <div>
            <label className="block text-xs font-semibold uppercase mb-1" style={{ color: "var(--theme-text-secondary)" }}>Speaker device</label>
            <select value={selectedOutputId ?? ""} onChange={(e) => setSelectedOutputId(e.target.value || null)} className="w-full px-2 py-1.5 rounded text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}>
              <option value="">Default</option>
              {audioOutputDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 6)}`}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="text-xs" style={{ color: "var(--theme-text-faint)" }}>Input device changes require rejoin. Presets and custom EQ are saved per user/profile.</p>
    </div>
  )
}

/** Memo-wrapped wrapper that provides stable per-peer callbacks to ParticipantTile. */
const PeerTileWrapper = memo(function PeerTileWrapper({
  peerId,
  stream,
  speaking,
  muted,
  userId,
  participantsByUserId,
  serverId,
  spotlightUserId,
  setSpotlightUserId,
  setParticipantVolume,
  setParticipantPan,
  spatialEnabled,
  compact,
}: {
  peerId: string
  stream: MediaStream
  speaking: boolean
  muted: boolean
  userId: string
  participantsByUserId: Map<string, VoiceParticipantInfo>
  serverId: string
  spotlightUserId: string | null
  setSpotlightUserId: (id: string | null) => void
  setParticipantVolume?: (serverId: string, userId: string, volume: number) => void
  setParticipantPan?: (serverId: string, userId: string, pan: number) => void
  spatialEnabled?: boolean
  compact?: boolean
}) {
  const peerInfo = participantsByUserId.get(userId)
  const peerIsScreenSharing = peerInfo?.selfStream ?? false
  const mix = useVoiceAudioStore((s) => s.participantMixByServer[serverId]?.[userId])

  const onVolumeChange = useCallback(
    (volume: number) => setParticipantVolume?.(serverId, userId, volume),
    [setParticipantVolume, serverId, userId]
  )
  const onPanChange = useCallback(
    (pan: number) => setParticipantPan?.(serverId, userId, pan),
    [setParticipantPan, serverId, userId]
  )
  const onViewStream = useMemo(() => {
    if (!peerIsScreenSharing) return undefined
    if (compact && spotlightUserId === userId) return undefined
    return () => setSpotlightUserId(userId)
  }, [peerIsScreenSharing, compact, spotlightUserId, userId, setSpotlightUserId])

  const tile = (
    <ParticipantTile
      user={peerInfo?.user}
      speaking={speaking}
      muted={muted}
      deafened={false}
      audioStream={stream}
      cameraStream={null}
      screenStream={null}
      isLocal={false}
      remoteStream={stream}
      compact={compact}
      onVolumeChange={!compact ? onVolumeChange : undefined}
      onPanChange={!compact ? onPanChange : undefined}
      volume={mix?.volume}
      pan={mix?.pan}
      spatialEnabled={spatialEnabled}
      onViewStream={onViewStream}
    />
  )

  if (compact) {
    return <div className="w-48 flex-shrink-0 min-w-0">{tile}</div>
  }
  return tile
})

/** Renders a single voice participant with avatar/video, status indicators, and optional volume controls. */
const ParticipantTile = memo(function ParticipantTile({
  user,
  speaking,
  muted,
  deafened,
  audioStream,
  cameraStream,
  screenStream,
  isLocal,
  remoteStream,
  onVolumeChange,
  onPanChange,
  volume,
  pan,
  spatialEnabled,
  onViewStream,
  compact,
}: {
  user?: UserRow | null
  speaking: boolean
  muted: boolean
  deafened: boolean
  audioStream: MediaStream | null
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  isLocal: boolean
  remoteStream?: MediaStream
  onVolumeChange?: (volume: number) => void
  onPanChange?: (pan: number) => void
  volume?: number
  pan?: number | null
  spatialEnabled?: boolean
  onViewStream?: () => void
  compact?: boolean
}) {
  const cameraRef = useRef<HTMLVideoElement>(null)
  const screenRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (cameraRef.current && cameraStream) cameraRef.current.srcObject = cameraStream
  }, [cameraStream])

  useEffect(() => {
    if (screenRef.current && screenStream) screenRef.current.srcObject = screenStream
  }, [screenStream])

  const [remoteHasVideo, setRemoteHasVideo] = useState(() => !!remoteStream && remoteStream.getVideoTracks().length > 0)
  useEffect(() => {
    if (!remoteStream) { setRemoteHasVideo(false); return }
    const update = () => setRemoteHasVideo(remoteStream.getVideoTracks().length > 0)
    update()
    remoteStream.addEventListener("addtrack", update)
    remoteStream.addEventListener("removetrack", update)
    return () => {
      remoteStream.removeEventListener("addtrack", update)
      remoteStream.removeEventListener("removetrack", update)
    }
  }, [remoteStream])
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream && remoteHasVideo) remoteVideoRef.current.srcObject = remoteStream
  }, [remoteStream, remoteHasVideo])

  const displayName = user?.display_name || user?.username || (isLocal ? "You" : "Unknown")
  const initials = displayName.slice(0, 2).toUpperCase()
  const showScreen = isLocal && !!screenStream
  const showCamera = isLocal && !!cameraStream && !showScreen
  const showRemoteVideo = !isLocal && remoteHasVideo

  return (
    <div
      className={cn(
        "group rounded-lg overflow-hidden flex flex-col relative transition-all duration-300",
        speaking && !muted ? "ring-2 ring-green-500/80" : "ring-1 ring-[var(--theme-text-faint)]/60"
      )}
      style={{
        background: "var(--theme-bg-tertiary)",
        minHeight: compact ? "100px" : (showScreen || showCamera || showRemoteVideo ? "240px" : "160px"),
      }}
    >
      {showScreen && <video ref={screenRef} autoPlay playsInline muted className="w-full flex-1 object-contain bg-black" />}
      {showCamera && <video ref={cameraRef} autoPlay playsInline muted className="w-full flex-1 object-cover bg-black" style={{ transform: "scaleX(-1)" }} />}
      {showRemoteVideo && <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full flex-1 object-cover bg-black" />}

      {!showScreen && !showCamera && !showRemoteVideo && (
        <div className="flex-1 flex items-center justify-center p-4">
          <Avatar className={compact ? "w-12 h-12" : "w-20 h-20"}>
            {user?.avatar_url && <AvatarImage src={user.avatar_url} />}
            <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: compact ? "14px" : "24px" }}>{initials}</AvatarFallback>
          </Avatar>
        </div>
      )}

      {onViewStream && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10" style={{ background: "rgba(0,0,0,0.4)" }}>
          <button
            type="button"
            onClick={() => onViewStream()}
            onMouseDown={(e) => e.preventDefault()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:brightness-110"
            style={{ background: "var(--theme-accent)" }}
          >
            <Monitor className="w-4 h-4" />
            View Stream
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2" style={{ background: "rgba(0,0,0,0.5)" }}>
        <span className={cn("font-medium text-white flex-1 truncate", compact ? "text-xs" : "text-sm")}>{displayName}</span>
        {speaking && !muted && (
          <span role="status" aria-label="Speaking" className="flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--theme-success) 20%, transparent)", color: "var(--theme-positive)" }}>
            <span className="speaking-waveform" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            {!compact && "Speaking"}
          </span>
        )}
        {isLocal && <span className="text-xs px-1 rounded" style={{ background: "var(--theme-accent)", color: "white" }}>You</span>}
        {muted && <MicOff className="w-3 h-3 flex-shrink-0" style={{ color: "var(--theme-danger)" }} />}
        {deafened && <Headphones className="w-3 h-3 flex-shrink-0" style={{ color: "var(--theme-danger)" }} />}
      </div>

      {!isLocal && !compact && onVolumeChange && (
        <div className="px-3 pb-3 space-y-1">
          <label className="text-[10px]" style={{ color: "var(--theme-text-muted)" }}>Volume {(volume ?? 1).toFixed(2)}x</label>
          <input type="range" min={0} max={2} step={0.05} value={volume ?? 1} onChange={(e) => onVolumeChange(Number(e.target.value))} className="w-full" />
          {spatialEnabled && onPanChange && (
            <>
              <label className="text-[10px]" style={{ color: "var(--theme-text-muted)" }}>Pan {(pan ?? 0).toFixed(2)}</label>
              <input type="range" min={-1} max={1} step={0.05} value={pan ?? 0} onChange={(e) => onPanChange(Number(e.target.value))} className="w-full" />
            </>
          )}
        </div>
      )}
    </div>
  )
})

/** Reactive wrapper that subscribes to per-participant mix from the store and passes computed volume/pan to RemoteAudio. */
const ReactiveRemoteAudio = memo(function ReactiveRemoteAudio({
  serverId,
  userId,
  stream,
  deafened,
  outputDeviceId,
  outputGain,
  spatialEnabled,
  peerIndex,
  sharedAudioContextRef,
}: {
  serverId: string
  userId: string
  stream: MediaStream
  deafened: boolean
  outputDeviceId: string | null
  outputGain: number
  spatialEnabled: boolean
  peerIndex: number
  sharedAudioContextRef: MutableRefObject<AudioContext | null>
}) {
  const mix = useVoiceAudioStore((s) => s.participantMixByServer[serverId]?.[userId])
  const volume = Math.min((mix?.volume ?? 1) * outputGain, MAX_REMOTE_GAIN)
  const pan = spatialEnabled ? (mix?.pan != null ? mix.pan : (peerIndex % 2 === 0 ? -0.2 : 0.2)) : 0

  return (
    <RemoteAudio
      stream={stream}
      deafened={deafened}
      outputDeviceId={outputDeviceId}
      volume={volume}
      pan={pan}
      sharedAudioContextRef={sharedAudioContextRef}
    />
  )
})

/** Hidden audio element that routes a remote peer's stream through Web Audio for gain and pan control. */
const RemoteAudio = memo(function RemoteAudio({
  stream,
  deafened,
  outputDeviceId,
  volume,
  pan,
  sharedAudioContextRef,
}: {
  stream: MediaStream
  deafened: boolean
  outputDeviceId: string | null
  volume: number
  pan: number
  sharedAudioContextRef: MutableRefObject<AudioContext | null>
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const gainRef = useRef<GainNode | null>(null)
  const panRef = useRef<StereoPannerNode | null>(null)
  const hasWebAudioRef = useRef(false)

  useEffect(() => {
    if (!audioRef.current) return

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      hasWebAudioRef.current = false
      return
    }

    hasWebAudioRef.current = true
    const context = sharedAudioContextRef.current ?? new AudioCtx()
    sharedAudioContextRef.current = context

    const source = context.createMediaStreamSource(stream)
    const gainNode = context.createGain()
    const panNode = context.createStereoPanner()
    source.connect(gainNode)
    gainNode.connect(panNode)
    panNode.connect(context.destination)
    gainRef.current = gainNode
    panRef.current = panNode

    return () => {
      source.disconnect()
      gainNode.disconnect()
      panNode.disconnect()
    }
  }, [stream])

  useEffect(() => {
    if (!audioRef.current || hasWebAudioRef.current) return
    audioRef.current.srcObject = stream
    audioRef.current.muted = deafened
  }, [stream, deafened])

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = deafened ? 0 : volume
    if (panRef.current) panRef.current.pan.value = pan
  }, [deafened, volume, pan])

  useEffect(() => {
    if (!outputDeviceId) return

    if (hasWebAudioRef.current && sharedAudioContextRef.current) {
      const maybeContextWithSink = sharedAudioContextRef.current as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      if (maybeContextWithSink.setSinkId) {
        maybeContextWithSink.setSinkId(outputDeviceId).catch(() => {
          // graceful fallback to default sink
        })
      }
      return
    }

    if (!hasWebAudioRef.current && audioRef.current) {
      const maybeSetSink = audioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      maybeSetSink.setSinkId?.(outputDeviceId).catch(() => {
        // graceful fallback to default sink
      })
    }
  // sharedAudioContextRef is a stable ref object; only outputDeviceId should trigger rerouting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputDeviceId])

  return <audio ref={audioRef} autoPlay playsInline className="hidden" />
})

/** Full-size video element used in spotlight mode to display a screen share stream. */
function SpotlightVideo({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  if (!stream) return null
  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />
}
