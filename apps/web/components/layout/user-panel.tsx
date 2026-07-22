"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Mic, MicOff, Headphones, PhoneOff, Settings } from "lucide-react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/use-toast"
import { UserPopover } from "@/components/layout/user-popover"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { getStatusColor } from "@/lib/utils/status-options"

/** Bottom-bar user panel with avatar, status selector, mute/deafen/disconnect controls, and settings shortcut. */
export function UserPanel() {
  const { currentUser, voiceChannelId, setVoiceChannel } = useAppStore(
    useShallow((s) => ({ currentUser: s.currentUser, voiceChannelId: s.voiceChannelId, setVoiceChannel: s.setVoiceChannel }))
  )
  const router = useRouter()
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const { toast } = useToast()
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const [isStatusExpired, setIsStatusExpired] = useState(false)

  useEffect(() => {
    if (!currentUser?.status_expires_at) {
      setIsStatusExpired(false)
      return
    }

    const expiryMs = new Date(currentUser.status_expires_at).getTime()
    if (Number.isNaN(expiryMs)) {
      setIsStatusExpired(true)
      return
    }

    const MAX_DELAY = 2 ** 31 - 1
    let timer: number | null = null

    const scheduleExpiryCheck = () => {
      const remaining = expiryMs - Date.now()
      if (remaining <= 0) {
        setIsStatusExpired(true)
        return
      }

      setIsStatusExpired(false)
      const delay = Math.min(remaining, MAX_DELAY)
      timer = window.setTimeout(() => {
        scheduleExpiryCheck()
      }, delay)
    }

    scheduleExpiryCheck()

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [currentUser?.id, currentUser?.status_expires_at])

  if (!currentUser) return null

  const displayName = currentUser.display_name || currentUser.username
  const initials = displayName.slice(0, 2).toUpperCase()
  const customStatusText = !isStatusExpired ? [currentUser.status_emoji, currentUser.status_message].filter(Boolean).join(" ").trim() : ""

  return (
    <div
      className="hidden md:flex items-center gap-2 p-2"
      style={{
        background: 'var(--theme-bg-secondary)',
        boxShadow: '0 -1px 0 var(--theme-bg-tertiary), inset 0 1px 0 color-mix(in srgb, var(--theme-accent) 7%, transparent)',
      }}
    >
      <UserPopover user={currentUser} isStatusExpired={isStatusExpired}>
        <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer focus-ring rounded" role="button" tabIndex={0} aria-label="Open profile popover">
          {/* Avatar with status */}
          <div className="relative flex-shrink-0">
            <Avatar className="w-8 h-8">
              {currentUser.avatar_url && <AvatarImage src={currentUser.avatar_url} />}
              <AvatarFallback style={{ background: 'var(--theme-accent)', color: 'white', fontSize: '12px' }}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
              style={{
                background: getStatusColor(currentUser.status),
                borderColor: 'var(--theme-bg-secondary)',
              }}
            />
          </div>

          {/* Username */}
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--theme-text-bright)' }}>{displayName}</div>
            {customStatusText ? (
              <div className="text-xs truncate" style={{ color: 'var(--theme-text-muted)' }}>
                {customStatusText}
              </div>
            ) : (
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                #{currentUser.username}
              </div>
            )}
          </div>
        </div>
      </UserPopover>

      {/* Controls */}
      <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-0.5">
        {voiceChannelId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  try {
                    const latestUser = useAppStore.getState().currentUser
                    if (latestUser) {
                      const { error } = await supabase
                        .from("voice_states")
                        .delete()
                        .eq("user_id", latestUser.id)
                        .eq("channel_id", voiceChannelId)
                      if (error) throw error
                    }
                    const sid = useAppStore.getState().voiceServerId
                    setVoiceChannel(null, null)
                    if (sid) {
                      const serverChannels = useAppStore.getState().channels[sid] ?? []
                      const textChannel = serverChannels
                        .filter((c) => c.type === "text")
                        .sort((a, b) => a.position - b.position)[0]
                      router.push(textChannel ? `/channels/${sid}/${textChannel.id}` : `/channels/${sid}`)
                    }
                    toast({ title: "Disconnected from voice" })
                  } catch (error: unknown) {
                    toast({ variant: "destructive", title: "Failed to disconnect", description: error instanceof Error ? error.message : "Unknown error" })
                  }
                }}
                aria-label="Disconnect from voice"
                className="w-7 h-7 rounded flex items-center justify-center surface-hover-danger motion-interactive focus-ring"
                style={{ color: 'var(--theme-danger)' }}
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Disconnect</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setMuted(!muted)}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={muted}
              className="w-7 h-7 rounded flex items-center justify-center surface-hover-md motion-interactive focus-ring"
              style={{ color: muted ? 'var(--theme-danger)' : 'var(--theme-text-muted)' }}
            >
              {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{muted ? "Unmute" : "Mute"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setDeafened(!deafened)}
              aria-label={deafened ? "Undeafen" : "Deafen"}
              aria-pressed={deafened}
              className="w-7 h-7 rounded flex items-center justify-center surface-hover-md motion-interactive focus-ring"
              style={{ color: deafened ? 'var(--theme-danger)' : 'var(--theme-text-muted)' }}
            >
              <Headphones className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{deafened ? "Undeafen" : "Deafen"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => router.push("/settings")}
              aria-label="User Settings"
              className="w-7 h-7 rounded flex items-center justify-center surface-hover-md motion-interactive focus-ring"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <Settings className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>User Settings</TooltipContent>
        </Tooltip>
      </div>
      </TooltipProvider>

    </div>
  )
}
