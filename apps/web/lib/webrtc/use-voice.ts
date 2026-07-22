"use client"

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { createInputAudioPipeline } from "@/lib/voice/audio-pipeline"
import { type VoiceAudioSettings } from "@/lib/voice/audio-settings"
import { useVoiceAudioStore } from "@/lib/stores/voice-audio-store"

interface PeerState {
  stream: MediaStream
  speaking: boolean
  muted: boolean
  userId: string
}

/** Network quality tier derived from WebRTC stats. */
export type NetworkQualityTier = "good" | "degraded" | "poor"

/** Aggregated network quality metrics from RTCPeerConnection.getStats(). */
export interface NetworkQualityStats {
  /** Round-trip time in milliseconds. */
  rttMs: number
  /** Packet loss percentage (0-100). */
  packetLossPercent: number
  /** Jitter in milliseconds. */
  jitterMs: number
  /** Available outbound bitrate in kbps, if reported. */
  availableBitrateKbps: number | null
  /** Derived quality tier. */
  tier: NetworkQualityTier
}

/** Connection state machine for the voice reconnect system — re-exported from the canonical manager. */
export type { VoiceConnectionState, ReconnectSnapshot as ReconnectInfo } from "./voice-reconnection-manager"
import type { VoiceConnectionState } from "./voice-reconnection-manager"
import type { ReconnectSnapshot as ReconnectInfo } from "./voice-reconnection-manager"

interface UseVoiceReturn {
  peers: Map<string, PeerState>
  muted: boolean
  deafened: boolean
  speaking: boolean
  screenSharing: boolean
  videoEnabled: boolean
  localStream: React.RefObject<MediaStream | null>
  screenStream: React.RefObject<MediaStream | null>
  cameraStream: React.RefObject<MediaStream | null>
  toggleMute: () => void
  toggleDeafen: () => void
  toggleScreenShare: () => Promise<void>
  toggleVideo: () => Promise<void>
  leaveChannel: () => void
  audioInputDevices: MediaDeviceInfo[]
  audioOutputDevices: MediaDeviceInfo[]
  selectedInputId: string | null
  selectedOutputId: string | null
  setSelectedInputId: (id: string | null) => void
  setSelectedOutputId: (id: string | null) => void
  audioSettings: VoiceAudioSettings
  setAudioSettings: (settings: VoiceAudioSettings) => void
  cpuBypassActive: boolean
  audioInitError: string | null
  /** True when audioInitError was caused by a browser permission denial. */
  isPermissionError: boolean
  /** Re-attempt microphone acquisition after a permission or init error. */
  retryAudioInit: () => void
  /** Network quality stats from getStats() polling (null until first poll). */
  networkQuality: NetworkQualityStats | null
  /** Reconnect state machine info. */
  reconnectInfo: ReconnectInfo
  /** Manual rejoin after max retries exhausted. */
  manualReconnect: () => void
}

const HEARTBEAT_INTERVAL_MS = 5000
const DEFAULT_STALE_PEER_TIMEOUT_MS = 45000
const envStalePeerTimeout = Number.parseInt(process.env.NEXT_PUBLIC_VOICE_STALE_PEER_TIMEOUT_MS ?? "", 10)
const STALE_PEER_TIMEOUT_MS = Number.isFinite(envStalePeerTimeout) && envStalePeerTimeout >= HEARTBEAT_INTERVAL_MS * 3
  ? envStalePeerTimeout
  : DEFAULT_STALE_PEER_TIMEOUT_MS

// ─── Reconnect constants ──────────────────────────────────────────────────────
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 5

// ─── Network quality constants ────────────────────────────────────────────────
const STATS_POLL_INTERVAL_MS = 5000
const RTT_YELLOW_MS = 150
const RTT_RED_MS = 300
const LOSS_YELLOW_PCT = 2
const LOSS_RED_PCT = 5

// ─── Bitrate adaptation constants ────────────────────────────────────────────
const BITRATE_GOOD = 64000 // 64 kbps
const BITRATE_DEGRADED = 32000 // 32 kbps
const BITRATE_POOR = 16000 // 16 kbps

/** Compute quality tier from RTT and packet loss. */
function computeQualityTier(rttMs: number, packetLossPercent: number): NetworkQualityTier {
  if (rttMs > RTT_RED_MS || packetLossPercent > LOSS_RED_PCT) return "poor"
  if (rttMs > RTT_YELLOW_MS || packetLossPercent > LOSS_YELLOW_PCT) return "degraded"
  return "good"
}

function bitrateForTier(tier: NetworkQualityTier): number {
  if (tier === "poor") return BITRATE_POOR
  if (tier === "degraded") return BITRATE_DEGRADED
  return BITRATE_GOOD
}

/** Applies maxBitrate to all audio senders across all peer connections. */
function applyBitrateToSenders(
  pcs: Map<string, RTCPeerConnection>,
  maxBitrate: number
): void {
  pcs.forEach((pc) => {
    try {
      const sender = pc.getSenders().find((s) => s.track?.kind === "audio")
      if (!sender) return
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) return
      params.encodings[0].maxBitrate = maxBitrate
      sender.setParameters(params).catch(() => undefined)
    } catch {
      // setParameters not supported in this browser — graceful fallback
    }
  })
}

/** Compute backoff delay with jitter for the given attempt number. */
function reconnectDelay(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS)
  // Add 10-30% random jitter to avoid thundering herd
  const jitter = base * (0.1 + Math.random() * 0.2)
  return Math.round(base + jitter)
}

/** Manages WebRTC peer connections, media streams, audio processing, and signaling for a voice channel. */
export function useVoice(channelId: string, userId: string, serverId?: string | null): UseVoiceReturn {
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map())
  const peersRef = useRef<Map<string, PeerState>>(new Map())
  peersRef.current = peers
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [cpuBypassActive, setCpuBypassActive] = useState(false)
  const [audioInitError, setAudioInitError] = useState<string | null>(null)
  const [isPermissionError, setIsPermissionError] = useState(false)
  const [audioRetryCounter, setAudioRetryCounter] = useState(0)
  const [rawLocalStream, setRawLocalStream] = useState<MediaStream | null>(null)
  const [networkQuality, setNetworkQuality] = useState<NetworkQualityStats | null>(null)
  const [reconnectInfo, setReconnectInfo] = useState<ReconnectInfo>({
    state: "connected",
    attempt: 0,
    maxAttempts: RECONNECT_MAX_ATTEMPTS,
  })

  const localStream = useRef<MediaStream | null>(null)
  const rawLocalStreamRef = useRef<MediaStream | null>(null)
  const screenStream = useRef<MediaStream | null>(null)
  const cameraStream = useRef<MediaStream | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map())
  const harkRef = useRef<{ stop: () => void } | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const pipelineCleanupRef = useRef<(() => void) | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const staleGcTimerRef = useRef<number | null>(null)
  const lastSeenByPeerRef = useRef<Map<string, number>>(new Map())
  const mutedRef = useRef(false)
  const deafenedRef = useRef(false)
  const speakingRef = useRef(false)
  const statsTimerRef = useRef<number | null>(null)
  const prevStatsRef = useRef<Map<string, { timestamp: number; packetsSent: number; packetsLost: number }>>(new Map())
  const currentTierRef = useRef<NetworkQualityTier>("good")

  // ─── Reconnect state refs ──────────────────────────────────────────────────
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const connectionStateRef = useRef<VoiceConnectionState>("connected")
  const iceRestartAttemptsRef = useRef<Map<string, number>>(new Map())
  const manualReconnectRef = useRef<(() => void) | null>(null)

  const clientIdRef = useRef<string>(crypto.randomUUID())
  const supabaseRef = useRef(createClientSupabaseClient())

  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([])
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null)
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null)

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

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    deafenedRef.current = deafened
  }, [deafened])

  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])

  // ─── Helper to update reconnect state ─────────────────────────────────────
  const setConnectionState = useCallback((state: VoiceConnectionState, attempt = 0) => {
    connectionStateRef.current = state
    reconnectAttemptRef.current = attempt
    setReconnectInfo({ state, attempt, maxAttempts: RECONNECT_MAX_ATTEMPTS })
  }, [])

  const cleanupVoiceSession = useCallback((supabaseClient = supabaseRef.current) => {
    harkRef.current?.stop()
    pipelineCleanupRef.current?.()
    pipelineCleanupRef.current = null

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }

    rawLocalStreamRef.current?.getTracks().forEach((t) => t.stop())
    rawLocalStreamRef.current = null
    setRawLocalStream(null)

    screenStream.current?.getTracks().forEach((t) => t.stop())
    cameraStream.current?.getTracks().forEach((t) => t.stop())

    if (channelRef.current) {
      supabaseClient.removeChannel(channelRef.current)
      channelRef.current = null
    }

    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }

    if (staleGcTimerRef.current) {
      window.clearInterval(staleGcTimerRef.current)
      staleGcTimerRef.current = null
    }

    if (statsTimerRef.current) {
      window.clearInterval(statsTimerRef.current)
      statsTimerRef.current = null
    }

    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    lastSeenByPeerRef.current.clear()
    prevStatsRef.current.clear()
    iceRestartAttemptsRef.current.clear()

    peerConnections.current.forEach((pc) => pc.close())
    peerConnections.current.clear()
  }, [])

  useEffect(() => {
    if (!navigator.mediaDevices) return
    async function enumerateDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setAudioInputDevices(devices.filter((d) => d.kind === "audioinput"))
        setAudioOutputDevices(devices.filter((d) => d.kind === "audiooutput"))
      } catch {
        // ignore
      }
    }
    enumerateDevices()
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices)
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices)
  }, [])

  useEffect(() => {
    if (!rawLocalStream) return

    pipelineCleanupRef.current?.()
    pipelineCleanupRef.current = null

    const pipeline = createInputAudioPipeline(rawLocalStream, audioSettings, audioContextRef)
    pipelineCleanupRef.current = pipeline.cleanup
    localStream.current = pipeline.processedStream
    setCpuBypassActive(pipeline.constrainedCpu)

    const nextTrack = pipeline.processedStream.getAudioTracks()[0]
    if (nextTrack) {
      peerConnections.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "audio")
        if (sender) sender.replaceTrack(nextTrack).catch(() => undefined)
      })
    }

    return () => {
      pipelineCleanupRef.current?.()
      pipelineCleanupRef.current = null
    }
  }, [audioSettings, rawLocalStream])

  // ─── Network quality stats polling ──────────────────────────────────────────
  useEffect(() => {
    async function pollStats() {
      const pcs = Array.from(peerConnections.current.entries())
      if (pcs.length === 0) {
        setNetworkQuality(null)
        return
      }

      let totalRtt = 0
      let totalJitter = 0
      let totalPacketsLost = 0
      let totalPacketsSent = 0
      let availableBitrate: number | null = null
      let candidatePairCount = 0

      const activePcs = pcs.filter(([, pc]) => pc.connectionState !== "closed" && pc.connectionState !== "failed")
      const statsResults = await Promise.allSettled(
        activePcs.map(async ([peerId, pc]) => ({ peerId, stats: await pc.getStats() }))
      )

      for (const result of statsResults) {
        if (result.status !== "fulfilled") continue
        const { peerId, stats } = result.value
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            const rtt = report.currentRoundTripTime
            if (typeof rtt === "number") {
              totalRtt += rtt * 1000 // convert seconds to ms
              candidatePairCount++
            }
            if (typeof report.availableOutgoingBitrate === "number") {
              availableBitrate = (availableBitrate ?? 0) + report.availableOutgoingBitrate / 1000 // bps to kbps
            }
          }
          if (report.type === "outbound-rtp" && report.kind === "audio") {
            const prevEntry = prevStatsRef.current.get(peerId)
            const packetsSent = report.packetsSent ?? 0
            if (prevEntry) {
              const deltaPackets = packetsSent - prevEntry.packetsSent
              if (deltaPackets > 0) {
                totalPacketsSent += deltaPackets
              }
            }
            prevStatsRef.current.set(peerId, {
              timestamp: report.timestamp,
              packetsSent,
              packetsLost: prevStatsRef.current.get(peerId)?.packetsLost ?? 0,
            })
          }
          if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
            const packetsLost = report.packetsLost ?? 0
            const prevEntry = prevStatsRef.current.get(peerId)
            if (prevEntry) {
              const deltaLost = packetsLost - prevEntry.packetsLost
              totalPacketsLost += Math.max(0, deltaLost)
            }
            if (prevEntry) {
              prevStatsRef.current.set(peerId, { ...prevEntry, packetsLost })
            }
          }
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            const jitter = report.jitter
            if (typeof jitter === "number") {
              totalJitter = Math.max(totalJitter, jitter * 1000) // worst-case jitter
            }
            // Also capture inbound packet loss
            const lost = report.packetsLost
            const received = report.packetsReceived
            if (typeof lost === "number" && typeof received === "number" && received > 0) {
              const total = lost + received
              const lossPct = (lost / total) * 100
              // Use inbound loss if it's worse
              if (lossPct > (totalPacketsSent > 0 ? (totalPacketsLost / totalPacketsSent) * 100 : 0)) {
                totalPacketsLost = lost
                totalPacketsSent = total
              }
            }
          }
        })
      }

      const rttMs = candidatePairCount > 0 ? Math.round(totalRtt / candidatePairCount) : 0
      const packetLossPercent = totalPacketsSent > 0
        ? Math.round((totalPacketsLost / totalPacketsSent) * 10000) / 100
        : 0
      const jitterMs = Math.round(totalJitter * 100) / 100

      const tier = computeQualityTier(rttMs, packetLossPercent)
      setNetworkQuality({
        rttMs,
        packetLossPercent,
        jitterMs,
        availableBitrateKbps: availableBitrate !== null ? Math.round(availableBitrate) : null,
        tier,
      })

      // Only apply bitrate adaptation when the quality tier transitions
      if (tier !== currentTierRef.current) {
        currentTierRef.current = tier
        applyBitrateToSenders(peerConnections.current, bitrateForTier(tier))
      }
    }

    statsTimerRef.current = window.setInterval(pollStats, STATS_POLL_INTERVAL_MS)
    // Run initial poll immediately
    pollStats()

    return () => {
      if (statsTimerRef.current) {
        window.clearInterval(statsTimerRef.current)
        statsTimerRef.current = null
      }
    }
  }, []) // stable interval — pollStats reads live state from refs

  useEffect(() => {
    let mounted = true
    const supabase = supabaseRef.current
    const myClientId = clientIdRef.current

    /** Build ICE server configuration with ephemeral TURN credentials. */
    async function getIceServers(): Promise<RTCIceServer[]> {
      const { fetchIceServers } = await import("@/lib/webrtc/ice-servers")
      return fetchIceServers()
    }

    /**
     * Attempt ICE restart for a specific peer, then fall back to full re-negotiation.
     * Returns true if an ICE restart was initiated, false if it needs full reconnect.
     */
    function attemptIceRestart(peerId: string, pc: RTCPeerConnection, rtChannel: RealtimeChannel): boolean {
      const attempts = iceRestartAttemptsRef.current.get(peerId) ?? 0
      if (attempts >= 2) {
        // ICE restart exhausted, need full re-negotiation
        iceRestartAttemptsRef.current.delete(peerId)
        return false
      }

      iceRestartAttemptsRef.current.set(peerId, attempts + 1)
      console.log(`[useVoice] ICE restart attempt ${attempts + 1} for peer ${peerId}`)

      try {
        pc.restartIce()
        // For the initiator side, create a new offer with iceRestart
        const weAreInitiator = myClientId > peerId
        if (weAreInitiator) {
          pc.createOffer({ iceRestart: true })
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
              rtChannel.send({
                type: "broadcast",
                event: "offer",
                payload: { to: peerId, from: myClientId, offer: pc.localDescription, userId },
              })
            })
            .catch((err) => {
              console.warn("[useVoice] ICE restart offer failed:", err)
              // Fall back to full re-negotiation
              fullReconnectPeer(peerId, rtChannel).catch(() => {})
            })
        }
        return true
      } catch (err) {
        console.warn("[useVoice] restartIce() call failed:", err)
        return false
      }
    }

    /** Tear down and fully re-create a peer connection (new offer/answer exchange). */
    async function fullReconnectPeer(peerId: string, rtChannel: RealtimeChannel): Promise<void> {
      const oldPc = peerConnections.current.get(peerId)
      // Get userId from peers ref
      const resolvedUserId = peersRef.current.get(peerId)?.userId ?? ""

      if (oldPc) {
        oldPc.onicecandidate = null
        oldPc.oniceconnectionstatechange = null
        oldPc.ontrack = null
        oldPc.onnegotiationneeded = null
        oldPc.close()
        peerConnections.current.delete(peerId)
      }
      iceRestartAttemptsRef.current.delete(peerId)

      try {
        if (resolvedUserId) {
          const stream = localStream.current ?? rawLocalStreamRef.current
          if (stream) {
            const initiator = myClientId > peerId
            await createPeerConnection(peerId, resolvedUserId, initiator, rtChannel, stream)
          }
        }
      } catch (err) {
        console.warn("[useVoice] fullReconnectPeer failed for", peerId, err)
      }
    }

    function removePeerConnection(peerId: string, closeConnection = true) {
      const pc = peerConnections.current.get(peerId)
      if (pc) {
        // Clear event handlers before closing to prevent stale callbacks and aid GC
        pc.onicecandidate = null
        pc.oniceconnectionstatechange = null
        pc.ontrack = null
        pc.onnegotiationneeded = null
        if (closeConnection) pc.close()
      }
      peerConnections.current.delete(peerId)
      lastSeenByPeerRef.current.delete(peerId)
      iceRestartAttemptsRef.current.delete(peerId)
      setPeers((prev) => {
        const next = new Map(prev)
        next.delete(peerId)
        return next
      })
    }

    async function createPeerConnection(
      peerId: string,
      peerUserId: string,
      initiator: boolean,
      rtChannel: RealtimeChannel,
      stream: MediaStream
    ): Promise<RTCPeerConnection> {
      const iceServers = await getIceServers()

      const pc = new RTCPeerConnection({ iceServers })
      peerConnections.current.set(peerId, pc)
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          rtChannel.send({
            type: "broadcast",
            event: "ice-candidate",
            payload: { to: peerId, from: myClientId, candidate },
          })
        }
      }

      // ─── ICE connection state monitoring (Task A + B) ────────────────────
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState
        console.log(`[useVoice] ICE state for peer ${peerId}: ${iceState}`)

        switch (iceState) {
          case "connected":
          case "completed":
            // Connection recovered or established
            iceRestartAttemptsRef.current.delete(peerId)
            // If we were in reconnecting state and all peers are now connected, mark connected
            if (connectionStateRef.current === "reconnecting") {
              const allConnected = Array.from(peerConnections.current.values()).every(
                (p) => p.iceConnectionState === "connected" || p.iceConnectionState === "completed"
              )
              if (allConnected) {
                setConnectionState("connected")
              }
            }
            break

          case "disconnected":
            // Transient — could recover on its own. Start reconnect state machine.
            if (connectionStateRef.current === "connected") {
              setConnectionState("reconnecting", 0)
            }
            // Try ICE restart first
            attemptIceRestart(peerId, pc, rtChannel)
            break

          case "failed":
            // ICE has completely failed
            if (connectionStateRef.current === "connected") {
              setConnectionState("reconnecting", 0)
            }
            // Try ICE restart, fall back to full re-negotiation
            const restarted = attemptIceRestart(peerId, pc, rtChannel)
            if (!restarted) {
              fullReconnectPeer(peerId, rtChannel).catch(() => {})
            }
            break

          case "closed":
            // Peer closed intentionally, no action needed
            break
        }
      }

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams
        setPeers((prev) => {
          const next = new Map(prev)
          const existing = next.get(peerId)
          next.set(peerId, {
            stream: remoteStream,
            speaking: existing?.speaking ?? false,
            muted: existing?.muted ?? false,
            userId: peerUserId,
          })
          return next
        })
      }

      if (initiator) {
        pc.onnegotiationneeded = async () => {
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            rtChannel.send({
              type: "broadcast",
              event: "offer",
              payload: { to: peerId, from: myClientId, offer, userId },
            })
          } catch (err) {
            console.warn("[useVoice] negotiationneeded failed for", peerId, err)
          }
        }
      }

      setPeers((prev) => {
        const next = new Map(prev)
        if (!next.has(peerId)) {
          next.set(peerId, {
            stream: new MediaStream(),
            speaking: false,
            muted: false,
            userId: peerUserId,
          })
        }
        return next
      })

      return pc
    }

    async function handlePeer(peerClientId: string, peerUserId: string, rtChannel: RealtimeChannel, stream: MediaStream): Promise<void> {
      if (peerClientId === myClientId) return
      if (peerConnections.current.has(peerClientId)) return
      lastSeenByPeerRef.current.set(peerClientId, Date.now())
      const initiator = myClientId > peerClientId
      try {
        await createPeerConnection(peerClientId, peerUserId, initiator, rtChannel, stream)
      } catch (err) {
        console.warn("[useVoice] handlePeer failed for", peerClientId, err)
      }
    }

    /**
     * Schedule exponential backoff reconnect. Called when the Supabase channel
     * itself goes down or when all peer ICE connections fail.
     */
    function scheduleFullSessionReconnect() {
      const attempt = reconnectAttemptRef.current
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        console.warn(`[useVoice] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached.`)
        setConnectionState("disconnected")
        return
      }

      const delay = reconnectDelay(attempt)
      console.log(`[useVoice] Scheduling reconnect attempt ${attempt + 1}/${RECONNECT_MAX_ATTEMPTS} in ${delay}ms`)
      setConnectionState("reconnecting", attempt + 1)

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        if (!mounted) return

        // Close all stale connections but preserve local stream
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current)
          channelRef.current = null
        }
        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current)
          heartbeatTimerRef.current = null
        }
        if (staleGcTimerRef.current) {
          window.clearInterval(staleGcTimerRef.current)
          staleGcTimerRef.current = null
        }
        peerConnections.current.forEach((pc) => pc.close())
        peerConnections.current.clear()
        lastSeenByPeerRef.current.clear()
        iceRestartAttemptsRef.current.clear()
        setPeers(new Map())

        // Re-join the voice room with preserved local stream
        const stream = localStream.current ?? rawLocalStreamRef.current
        if (!stream) {
          console.warn("[useVoice] No local stream available for reconnect")
          setConnectionState("disconnected")
          return
        }

        joinChannel(stream).catch((err) => {
          console.error("[useVoice] Reconnect attempt failed:", err)
          scheduleFullSessionReconnect()
        })
      }, delay)
    }

    /**
     * Join (or rejoin) the Supabase Realtime channel and set up all signaling handlers.
     * Separated from init() so reconnect can reuse the same stream.
     */
    async function joinChannel(stream: MediaStream) {
      const rtChannel = supabase.channel(`voice-room:${channelId}`, {
        config: { broadcast: { self: false }, presence: { key: myClientId } },
      })
      channelRef.current = rtChannel

      rtChannel.on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload.to !== myClientId || !mounted) return
        const from = payload.from as string

        let pc = peerConnections.current.get(from)
        if (!pc) {
          pc = await createPeerConnection(from, payload.userId as string, false, rtChannel, localStream.current ?? stream)
        }

        await pc.setRemoteDescription(payload.offer as RTCSessionDescriptionInit)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        rtChannel.send({
          type: "broadcast",
          event: "answer",
          payload: { to: from, from: myClientId, answer },
        })
      })

      rtChannel.on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.to !== myClientId) return
        const pc = peerConnections.current.get(payload.from as string)
        if (pc) await pc.setRemoteDescription(payload.answer as RTCSessionDescriptionInit)
      })

      rtChannel.on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (payload.to !== myClientId) return
        const pc = peerConnections.current.get(payload.from as string)
        if (pc) await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit)
      })

      rtChannel.on("broadcast", { event: "peer-speaking" }, ({ payload }) => {
        lastSeenByPeerRef.current.set(payload.from as string, Date.now())
        setPeers((prev) => {
          const next = new Map(prev)
          const peer = next.get(payload.from as string)
          if (peer) next.set(payload.from as string, { ...peer, speaking: payload.speaking as boolean })
          return next
        })
      })

      rtChannel.on("broadcast", { event: "peer-muted" }, ({ payload }) => {
        lastSeenByPeerRef.current.set(payload.from as string, Date.now())
        setPeers((prev) => {
          const next = new Map(prev)
          const peer = next.get(payload.from as string)
          if (peer) next.set(payload.from as string, { ...peer, muted: payload.muted as boolean })
          return next
        })
      })

      rtChannel.on("broadcast", { event: "peer-heartbeat" }, ({ payload }) => {
        const from = payload.from as string
        if (from === myClientId) return
        lastSeenByPeerRef.current.set(from, Date.now())
        setPeers((prev) => {
          const next = new Map(prev)
          const peer = next.get(from)
          if (peer) {
            next.set(from, {
              ...peer,
              muted: Boolean(payload.muted),
              speaking: Boolean(payload.speaking),
            })
          }
          return next
        })
      })

      rtChannel.on("broadcast", { event: "peer-rejoin-request" }, ({ payload }) => {
        const requester = payload.from as string
        if (requester === myClientId) return
        channelRef.current?.send({
          type: "broadcast",
          event: "peer-rejoin-state",
          payload: {
            to: requester,
            from: myClientId,
            userId,
            muted: mutedRef.current,
            speaking: speakingRef.current,
          },
        })
      })

      rtChannel.on("broadcast", { event: "peer-rejoin-state" }, ({ payload }) => {
        if ((payload.to as string) !== myClientId) return
        const from = payload.from as string
        lastSeenByPeerRef.current.set(from, Date.now())
        handlePeer(from, payload.userId as string, rtChannel, localStream.current ?? stream)
        setPeers((prev) => {
          const next = new Map(prev)
          const peer = next.get(from)
          if (peer) {
            next.set(from, {
              ...peer,
              muted: Boolean(payload.muted),
              speaking: Boolean(payload.speaking),
            })
          }
          return next
        })
      })

      rtChannel.on("presence", { event: "join" }, ({ newPresences }) => {
        if (!mounted) return
        for (const p of (newPresences as unknown) as Array<{ client_id: string; user_id: string }>) {
          handlePeer(p.client_id, p.user_id, rtChannel, localStream.current ?? stream)
        }
      })

      rtChannel.on("presence", { event: "leave" }, ({ leftPresences }) => {
        for (const p of (leftPresences as unknown) as Array<{ client_id: string }>) {
          removePeerConnection(p.client_id)
        }
      })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!mounted) return resolve()
          reject(new Error("Realtime subscription timeout"))
        }, 10000)
        rtChannel.subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout)
            if (!mounted) return resolve()
            await rtChannel.track({ client_id: myClientId, user_id: userId })

            channelRef.current?.send({
              type: "broadcast",
              event: "peer-rejoin-request",
              payload: { from: myClientId },
            })

            const sendHeartbeat = () => {
              channelRef.current?.send({
                type: "broadcast",
                event: "peer-heartbeat",
                payload: {
                  from: myClientId,
                  userId,
                  muted: mutedRef.current,
                  speaking: speakingRef.current,
                },
              })
            }

            sendHeartbeat()
            heartbeatTimerRef.current = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

            staleGcTimerRef.current = window.setInterval(() => {
              const now = Date.now()
              for (const [peerId, lastSeen] of lastSeenByPeerRef.current.entries()) {
                if (now - lastSeen <= STALE_PEER_TIMEOUT_MS) continue
                const pc = peerConnections.current.get(peerId)
                const isConnected = pc?.connectionState === "connected"
                const isIceConnected = pc?.iceConnectionState === "connected" || pc?.iceConnectionState === "completed"
                const shouldKeepPeer = isConnected || isIceConnected
                if (shouldKeepPeer) {
                  lastSeenByPeerRef.current.set(peerId, now)
                  continue
                }

                const isEvictableState = !pc
                  || pc.connectionState === "disconnected"
                  || pc.connectionState === "failed"
                  || pc.connectionState === "closed"
                  || pc.iceConnectionState === "disconnected"
                  || pc.iceConnectionState === "failed"
                  || pc.iceConnectionState === "closed"
                if (!isEvictableState) continue

                removePeerConnection(peerId)
              }
            }, HEARTBEAT_INTERVAL_MS)

            const state = rtChannel.presenceState<{ client_id: string; user_id: string }>()
            for (const presences of Object.values(state)) {
              for (const p of presences) {
                handlePeer(p.client_id, p.user_id, rtChannel, localStream.current ?? stream)
              }
            }

            // Successfully joined — reset reconnect state
            setConnectionState("connected")

            resolve()
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timeout)
            reject(new Error(`Realtime channel ${status}`))
          }
        })
      })
    }

    async function init() {
      try {
        setAudioInitError(null)
        setIsPermissionError(false)
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
        if (selectedInputId) audioConstraints.deviceId = { ideal: selectedInputId }
        const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false })
        // Keep both in sync intentionally:
        // - rawLocalStreamRef is for synchronous access in callbacks/event handlers
        // - rawLocalStream state triggers the pipeline effect reactively
        rawLocalStreamRef.current = rawStream
        setRawLocalStream(rawStream)

        if (!mounted) {
          rawStream.getTracks().forEach((t) => t.stop())
          return
        }

        await joinChannel(rawStream)

        try {
          const { default: hark } = await import("hark")
          const speechEvents = hark(rawStream, { interval: 100, threshold: -65 })
          harkRef.current = speechEvents

          speechEvents.on("speaking", () => {
            if (!mounted) return
            setSpeaking(true)
            channelRef.current?.send({
              type: "broadcast",
              event: "peer-speaking",
              payload: { from: myClientId, speaking: true },
            })
          })

          speechEvents.on("stopped_speaking", () => {
            if (!mounted) return
            setSpeaking(false)
            channelRef.current?.send({
              type: "broadcast",
              event: "peer-speaking",
              payload: { from: myClientId, speaking: false },
            })
          })
        } catch (e) {
          console.warn("hark VAD failed to load:", e)
        }
      } catch (error: unknown) {
        // Stop any acquired mic stream to avoid a dangling active-mic indicator
        if (rawLocalStreamRef.current) {
          rawLocalStreamRef.current.getTracks().forEach((t) => t.stop())
          rawLocalStreamRef.current = null
        }
        setRawLocalStream(null)

        const errName = error instanceof DOMException || error instanceof Error ? error.name : undefined
        const errMsg = error instanceof Error ? error.message : String(error)
        let userMessage: string
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
          userMessage = "Microphone access was denied. Check your browser's site permissions and try again."
          setIsPermissionError(true)
        } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
          userMessage = "No microphone found. Connect a mic and try again."
        } else if (errName === "NotReadableError" || errName === "TrackStartError") {
          userMessage = "Microphone is in use by another app."
        } else if (errName === "OverconstrainedError") {
          userMessage = "Microphone doesn't support the requested settings. Try a different device."
        } else if (errMsg.includes("timeout") || errMsg.includes("TIMED_OUT")) {
          userMessage = "Realtime connection timed out. Check network."
        } else if (errMsg.includes("CHANNEL_ERROR")) {
          userMessage = "Realtime channel error. Check Supabase config."
        } else {
          userMessage = "Voice initialization failed. Please try again."
        }
        setAudioInitError(userMessage)
        console.error("[useVoice] init failed:", { name: errName, message: errMsg, error })
      }
    }

    // ─── Network recovery listener ────────────────────────────────────────────
    function handleOnline() {
      console.log("[useVoice] Browser went online, checking connections...")
      // If we're disconnected (max retries exceeded), don't auto-reconnect — user must manually rejoin
      if (connectionStateRef.current === "disconnected") return

      // Check if any peer connections need recovery
      let anyFailed = false
      peerConnections.current.forEach((pc, peerId) => {
        const iceState = pc.iceConnectionState
        if (iceState === "disconnected" || iceState === "failed") {
          anyFailed = true
          const rtChannel = channelRef.current
          if (rtChannel) {
            const restarted = attemptIceRestart(peerId, pc, rtChannel)
            if (!restarted) {
              fullReconnectPeer(peerId, rtChannel).catch(() => {})
            }
          }
        }
      })

      // If the channel itself is down, do a full session reconnect
      if (!channelRef.current || anyFailed) {
        if (connectionStateRef.current !== "reconnecting") {
          reconnectAttemptRef.current = 0
          scheduleFullSessionReconnect()
        }
      }
    }

    function handleOffline() {
      console.log("[useVoice] Browser went offline")
      if (connectionStateRef.current === "connected") {
        setConnectionState("reconnecting", 0)
      }
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Store manual reconnect handler for external use
    manualReconnectRef.current = () => {
      reconnectAttemptRef.current = 0
      iceRestartAttemptsRef.current.clear()
      scheduleFullSessionReconnect()
    }

    init()

    return () => {
      mounted = false
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      manualReconnectRef.current = null
      cleanupVoiceSession(supabase)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, userId, selectedInputId, audioRetryCounter, cleanupVoiceSession, setConnectionState])

  const retryAudioInit = useCallback((): void => {
    setAudioRetryCounter((c) => c + 1)
  }, [])

  const toggleMute = useCallback(() => {
    const tracks = rawLocalStreamRef.current?.getAudioTracks() ?? []
    const newMuted = !muted
    tracks.forEach((t) => { t.enabled = !newMuted })
    setMuted(newMuted)
    channelRef.current?.send({
      type: "broadcast",
      event: "peer-muted",
      payload: { from: clientIdRef.current, muted: newMuted },
    })
  }, [muted])

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => !prev)
  }, [])

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      screenStream.current?.getTracks().forEach((t) => t.stop())
      screenStream.current = null
      setScreenSharing(false)
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" } as MediaTrackConstraints,
          audio: true,
        })
        screenStream.current = stream
        setScreenSharing(true)

        peerConnections.current.forEach((pc) => {
          const [videoTrack] = stream.getVideoTracks()
          const sender = pc.getSenders().find((s) => s.track?.kind === "video")
          if (sender) sender.replaceTrack(videoTrack)
          else pc.addTrack(videoTrack, stream)

          // Add system audio track from screen share if available
          const [audioTrack] = stream.getAudioTracks()
          if (audioTrack) {
            // Check if there's an existing screen-share audio sender to replace
            const existingAudioSenders = pc.getSenders().filter((s) => s.track?.kind === "audio")
            // If we have more than one audio sender (mic + previous share), replace the extra one
            if (existingAudioSenders.length > 1) {
              existingAudioSenders[existingAudioSenders.length - 1].replaceTrack(audioTrack)
            } else {
              pc.addTrack(audioTrack, stream)
            }
          }
        })

        stream.getVideoTracks()[0].onended = () => {
          // Remove screen-share audio senders from peer connections
          const shareAudioTracks = screenStream.current?.getAudioTracks() ?? []
          if (shareAudioTracks.length > 0) {
            peerConnections.current.forEach((pc) => {
              pc.getSenders().forEach((s) => {
                if (s.track && shareAudioTracks.includes(s.track)) {
                  try { pc.removeTrack(s) } catch { /* noop */ }
                }
              })
            })
            shareAudioTracks.forEach((t) => { t.stop() })
          }
          screenStream.current = null
          setScreenSharing(false)
        }
      } catch (err) {
        if (err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")) return
        console.error("Screen share failed:", err)
      }
    }
  }, [screenSharing])

  const toggleVideo = useCallback(async () => {
    if (videoEnabled) {
      cameraStream.current?.getTracks().forEach((t) => t.stop())
      cameraStream.current = null
      setVideoEnabled(false)
      peerConnections.current.forEach((pc) => {
        pc.getSenders().filter((s) => s.track?.kind === "video" && !screenSharing)
          .forEach((s) => { try { pc.removeTrack(s) } catch { /* noop */ } })
      })
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        cameraStream.current = stream
        setVideoEnabled(true)
        peerConnections.current.forEach((pc) => {
          const [videoTrack] = stream.getVideoTracks()
          const sender = pc.getSenders().find((s) => s.track?.kind === "video")
          if (sender) sender.replaceTrack(videoTrack)
          else pc.addTrack(videoTrack, stream)
        })
        stream.getVideoTracks()[0].onended = () => {
          cameraStream.current = null
          setVideoEnabled(false)
        }
      } catch (e) {
        console.log("Camera access failed:", e)
      }
    }
  }, [videoEnabled, screenSharing])

  const leaveChannel = useCallback(() => {
    cleanupVoiceSession()
    setPeers(new Map())
    setConnectionState("connected")
    setNetworkQuality(null)
  }, [cleanupVoiceSession, setConnectionState])

  const manualReconnect = useCallback(() => {
    manualReconnectRef.current?.()
  }, [])

  return {
    peers,
    muted,
    deafened,
    speaking,
    screenSharing,
    videoEnabled,
    localStream,
    screenStream,
    cameraStream,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    toggleVideo,
    leaveChannel,
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
  }
}
