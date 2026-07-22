"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Hash, Volume2, Clipboard, MessageSquare, Mic2, Megaphone, Image, Clock, MessageCircle,
  MicOff, Headphones, Bell, BellOff, Eye, CheckCheck, ChevronDown, ChevronRight
} from "lucide-react"
import { cn } from "@/lib/utils/cn"
import type { ChannelRow } from "@/types/database"
import { useAppStore } from "@/lib/stores/app-store"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { OptimizedAvatarImage } from "@/components/ui/optimized-avatar-image"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"
import { useToast } from "@/components/ui/use-toast"
import type { VoiceParticipant } from "@vortex/shared"
import { ChannelIcon } from "@/components/layout/sortable-channel-item"

function formatTimeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return "expired"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h`
  const totalDays = Math.floor(totalHours / 24)
  return `${totalDays}d`
}

/** Static category header — no dnd-kit hooks. */
export function StaticCategoryHeader({
  category,
  isCollapsed,
  onToggle,
  onCopyId,
}: {
  category: ChannelRow
  isCollapsed: boolean
  onToggle: () => void
  onCopyId?: () => void
}): React.ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="flex items-center justify-between px-2 py-2 md:py-1 group rounded mx-1 motion-interactive"
        >
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1 flex-1 min-w-0 min-h-[44px] text-left focus-ring rounded-sm"
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} category ${category.name}`}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 md:w-3 md:h-3 tertiary-metadata" />
            ) : (
              <ChevronDown className="w-4 h-4 md:w-3 md:h-3 tertiary-metadata" />
            )}
            <span className="text-sm md:text-xs font-semibold uppercase tracking-wider tertiary-metadata truncate">
              {category.name}
            </span>
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56" aria-label={`Category actions for ${category.name}`}>
        {onCopyId && (
          <ContextMenuItem onClick={onCopyId}>
            <Clipboard className="w-4 h-4 mr-2" /> Copy Category ID
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface StaticChannelItemProps {
  channel: ChannelRow
  isActive: boolean
  isVoiceActive: boolean
  isUnread?: boolean
  mentionCount?: number
  activeThreadCount?: number
  voiceParticipants?: VoiceParticipant[]
  href?: string
  onClick: () => void
  onCreateThread?: () => void
  onMarkRead?: () => void
  onOpenNotificationSettings: (channelId: string) => void
}

/** Static channel item — no dnd-kit hooks, no drag handle. */
export function StaticChannelItem({
  channel,
  isActive,
  isVoiceActive,
  isUnread,
  mentionCount,
  activeThreadCount,
  voiceParticipants,
  href,
  onClick,
  onCreateThread,
  onMarkRead,
  onOpenNotificationSettings,
}: StaticChannelItemProps): React.ReactElement {
  const router = useRouter()
  const { toast } = useToast()
  const notificationMode = useAppStore((s) => s.notificationModes[channel.id])
  const isMuted = notificationMode === "muted"
  const showBadge = !isActive && !isMuted && (isUnread || (mentionCount ?? 0) > 0)

  const [timeRemaining, setTimeRemaining] = useState<string | null>(
    channel.expires_at ? formatTimeRemaining(channel.expires_at) : null
  )
  useEffect(() => {
    if (!channel.expires_at) {
      setTimeRemaining(null)
      return
    }
    setTimeRemaining(formatTimeRemaining(channel.expires_at))
    let timerId: ReturnType<typeof setTimeout> | null = null
    function tick(): void {
      const ms = new Date(channel.expires_at!).getTime() - Date.now()
      setTimeRemaining(formatTimeRemaining(channel.expires_at!))
      if (ms <= 0) return // expired — stop scheduling
      const delay = ms <= 60_000 ? 1_000 : 30_000
      timerId = setTimeout(tick, delay)
    }
    const initialMs = new Date(channel.expires_at).getTime() - Date.now()
    if (initialMs > 0) {
      const initialDelay = initialMs <= 60_000 ? 1_000 : 30_000
      timerId = setTimeout(tick, initialDelay)
    }
    return () => { if (timerId !== null) clearTimeout(timerId) }
  }, [channel.expires_at])

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onMouseEnter={() => { if (href) router.prefetch(href) }}
            onFocus={() => { if (href) router.prefetch(href) }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }}
            aria-label={`${channel.type} channel ${channel.name}`}
            className={cn(
              "relative flex items-center gap-2.5 md:gap-2 px-3 md:px-2 py-2.5 md:py-1.5 rounded w-full text-left motion-interactive motion-press text-base md:text-sm group/channel cursor-pointer select-none focus-ring touch-manipulation",
              isActive || isVoiceActive ? "channel-active channel-sidebar-active-elevated" : "surface-hover text-muted-interactive",
              isUnread && !isActive && "channel-sidebar-unread channel-sidebar-unread-elevated"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all duration-300 channel-sidebar-accent-bar",
                isActive || isVoiceActive
                  ? "opacity-100 h-8 w-1 channel-sidebar-accent-bar-active"
                  : "opacity-0 h-5 w-0 group-hover/channel:opacity-60 group-hover/channel:w-0.5 group-hover/channel:h-5"
              )}
            />
            <ChannelIcon channel={channel} isVoiceActive={isVoiceActive} />
            <span className={cn("truncate flex-1", isMuted && "opacity-50", isUnread && !isActive && !isMuted ? "font-semibold" : "")}>
              {channel.name}
            </span>
            {isMuted && (
              <BellOff className="w-3 h-3 flex-shrink-0 opacity-40" />
            )}
            <span className="ml-auto flex items-center gap-1 flex-shrink-0 tertiary-metadata">
              {timeRemaining && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-0.5 text-[10px] font-medium px-1 py-0.5 rounded channel-sidebar-warning-chip">
                      <Clock className="w-2.5 h-2.5" />
                      {timeRemaining}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Ephemeral channel — deletes {timeRemaining === "expired" ? "soon" : `in ${timeRemaining}`}
                  </TooltipContent>
                </Tooltip>
              )}
              {isVoiceActive && (
                <span className="w-2 h-2 rounded-full inline-block animate-pulse channel-sidebar-success-dot" />
              )}
              {showBadge && (mentionCount ?? 0) > 0 ? (
                <span className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] font-bold px-1 channel-sidebar-mention-badge">
                  {(mentionCount ?? 0) > 99 ? "99+" : mentionCount}
                </span>
              ) : showBadge ? (
                <span className="w-2 h-2 rounded-full channel-sidebar-unread-dot" />
              ) : null}
              {(activeThreadCount ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[10px] font-semibold channel-sidebar-thread-pill"
                  title={`${activeThreadCount} active ${activeThreadCount === 1 ? "thread" : "threads"} in #${channel.name}`}
                >
                  <MessageCircle className="h-2.5 w-2.5" />
                  {activeThreadCount}
                </span>
              )}
            </span>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-56" aria-label={`Channel actions for #${channel.name}`}>
          {onCreateThread && channel.type === "text" && (
            <>
              <ContextMenuItem onClick={onCreateThread}>
                <MessageSquare className="w-4 h-4 mr-2" /> Create Thread
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {onMarkRead && (isUnread || (mentionCount ?? 0) > 0) && (
            <>
              <ContextMenuItem onClick={onMarkRead}>
                <CheckCheck className="w-4 h-4 mr-2" /> Mark as Read
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => onOpenNotificationSettings(channel.id)}>
            <Bell className="w-4 h-4 mr-2" /> Notification Settings
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            window.dispatchEvent(new CustomEvent("vortex:open-transparency", { detail: { serverId: channel.server_id, channelId: channel.id } }))
          }}>
            <Eye className="w-4 h-4 mr-2" /> Transparency
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            void navigator.clipboard.writeText(channel.id)
              .then(() => { toast({ title: "Channel ID copied!" }) })
              .catch(() => { toast({ variant: "destructive", title: "Failed to copy channel ID" }) })
          }}>
            <Clipboard className="w-4 h-4 mr-2" /> Copy Channel ID
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {voiceParticipants && voiceParticipants.length > 0 && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {voiceParticipants.map((participant) => {
            const name = participant.user?.display_name || participant.user?.username || "Unknown"
            const initials = name.slice(0, 2).toUpperCase()
            return (
              <div
                key={participant.user_id}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs surface-hover channel-sidebar-description"
              >
                <Avatar className="w-5 h-5 flex-shrink-0">
                  {participant.user?.avatar_url && (
                    <OptimizedAvatarImage src={participant.user.avatar_url} size={20} />
                  )}
                  <AvatarFallback className="channel-sidebar-avatar-fallback" style={{ fontSize: "8px" }}>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{name}</span>
                {participant.muted && <MicOff className="w-3 h-3 flex-shrink-0 channel-sidebar-danger-icon" />}
                {participant.deafened && <Headphones className="w-3 h-3 flex-shrink-0 channel-sidebar-danger-icon" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
