"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PhoneOff, Volume2, Mic, MicOff, Headphones, RefreshCw, WifiOff } from "lucide-react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import type { ReconnectInfo } from "@/lib/webrtc/use-voice"

/**
 * CompactVoiceCallView — persistent mini-bar shown in the sidebar whenever
 * the user is connected to a voice channel but has navigated away.
 *
 * Shows connection status, channel name, mute/deafen quick-toggles, and
 * reconnection state so the user always knows they're still in a call.
 */
export function CompactVoiceBar() {
  const {
    voiceChannelId,
    voiceServerId,
    voiceChannelName,
    voiceMuted,
    voiceDeafened,
    voiceReconnectInfo,
    setVoiceChannel,
  } = useAppStore(
    useShallow((s) => ({
      voiceChannelId: s.voiceChannelId,
      voiceServerId: s.voiceServerId,
      voiceChannelName: s.voiceChannelName,
      voiceMuted: s.voiceMuted ?? false,
      voiceDeafened: s.voiceDeafened ?? false,
      voiceReconnectInfo: s.voiceReconnectInfo as ReconnectInfo | null,
      setVoiceChannel: s.setVoiceChannel,
    }))
  )
  const router = useRouter()
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const { toast } = useToast()

  // Elapsed time since joining voice
  const [elapsed, setElapsed] = useState("")
  const voiceJoinedAt = useAppStore((s) => s.voiceJoinedAt)

  useEffect(() => {
    if (!voiceJoinedAt) return
    function tick() {
      const diff = Math.floor((Date.now() - voiceJoinedAt!) / 1000)
      const m = Math.floor(diff / 60)
      const s = diff % 60
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [voiceJoinedAt])

  if (!voiceChannelId) return null

  const isReconnecting = voiceReconnectInfo?.state === "reconnecting"
  const isDisconnected = voiceReconnectInfo?.state === "disconnected"

  async function handleDisconnect() {
    const userId = useAppStore.getState().currentUser?.id
    if (!userId || !voiceChannelId) return
    try {
      await supabase.from("voice_states").delete().eq("user_id", userId).eq("channel_id", voiceChannelId)
      const sid = useAppStore.getState().voiceServerId
      setVoiceChannel(null, null)
      if (sid) {
        const serverChannels = useAppStore.getState().channels[sid] ?? []
        const textChannel = serverChannels
          .filter((c) => c.type === "text")
          .sort((a, b) => a.position - b.position)[0]
        router.push(textChannel ? `/channels/${sid}/${textChannel.id}` : `/channels/${sid}`)
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to disconnect from voice" })
    }
  }

  function handleToggleMute() {
    const toggleMute = useAppStore.getState().voiceToggleMute
    toggleMute?.()
  }

  function handleToggleDeafen() {
    const toggleDeafen = useAppStore.getState().voiceToggleDeafen
    toggleDeafen?.()
  }

  function handleManualReconnect() {
    const reconnect = useAppStore.getState().voiceManualReconnect
    reconnect?.()
  }

  // Connection status color and label
  let statusColor = "var(--theme-success)"
  let statusLabel = "Voice Connected"
  if (isReconnecting) {
    statusColor = "var(--theme-warning)"
    statusLabel = `Reconnecting (${voiceReconnectInfo!.attempt}/${voiceReconnectInfo!.maxAttempts})`
  } else if (isDisconnected) {
    statusColor = "var(--theme-danger)"
    statusLabel = "Connection Lost"
  }

  return (
    <div className="px-2 py-2 border-b flex-shrink-0" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
      {/* Status line */}
      <div className="flex items-center gap-2 mb-1">
        {isReconnecting ? (
          <RefreshCw className="w-3 h-3 flex-shrink-0 animate-spin" style={{ color: statusColor }} />
        ) : isDisconnected ? (
          <WifiOff className="w-3 h-3 flex-shrink-0" style={{ color: statusColor }} />
        ) : (
          <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: statusColor }} />
        )}
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: statusColor }}>
          {statusLabel}
        </span>
        {elapsed && !isDisconnected && (
          <span className="text-[10px] tabular-nums" style={{ color: "var(--theme-text-muted)" }}>{elapsed}</span>
        )}
      </div>

      {/* Channel name + actions */}
      <div className="flex items-center gap-1">
        <Volume2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
        <button
          onClick={() => voiceServerId && router.push(`/channels/${voiceServerId}/${voiceChannelId}`)}
          className="text-xs flex-1 text-left truncate hover:underline"
          style={{ color: "var(--theme-text-secondary)" }}
          title="Return to voice channel"
        >
          {voiceChannelName ?? "Voice channel"}
        </button>

        {/* Mute toggle */}
        <button
          onClick={handleToggleMute}
          className="w-6 h-6 rounded flex items-center justify-center motion-interactive flex-shrink-0"
          style={{
            color: voiceMuted ? "var(--theme-danger)" : "var(--theme-text-secondary)",
            background: voiceMuted ? "color-mix(in srgb, var(--theme-danger) 15%, transparent)" : "transparent",
          }}
          title={voiceMuted ? "Unmute" : "Mute"}
          aria-label={voiceMuted ? "Unmute" : "Mute"}
        >
          {voiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        </button>

        {/* Deafen toggle */}
        <button
          onClick={handleToggleDeafen}
          className="w-6 h-6 rounded flex items-center justify-center motion-interactive flex-shrink-0"
          style={{
            color: voiceDeafened ? "var(--theme-danger)" : "var(--theme-text-secondary)",
            background: voiceDeafened ? "color-mix(in srgb, var(--theme-danger) 15%, transparent)" : "transparent",
          }}
          title={voiceDeafened ? "Undeafen" : "Deafen"}
          aria-label={voiceDeafened ? "Undeafen" : "Deafen"}
        >
          <Headphones className="w-3.5 h-3.5" />
        </button>

        {/* Manual reconnect when disconnected */}
        {isDisconnected && (
          <button
            onClick={handleManualReconnect}
            className="w-6 h-6 rounded flex items-center justify-center motion-interactive flex-shrink-0"
            style={{ color: "var(--theme-warning)" }}
            title="Rejoin voice"
            aria-label="Rejoin voice"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Disconnect */}
        <button
          onClick={handleDisconnect}
          className="w-6 h-6 rounded flex items-center justify-center surface-hover-danger motion-interactive flex-shrink-0"
          style={{ color: "var(--theme-danger)" }}
          title="Disconnect from voice"
          aria-label="Disconnect from voice"
        >
          <PhoneOff className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
