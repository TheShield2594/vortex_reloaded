"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Hash, Volume2, Plus, Clipboard, Pencil, Trash2, MessageSquare, Mic2, Megaphone, Image, Clock, GripVertical, MessageCircle,
  MicOff, Headphones, Bell, BellOff, Eye, CheckCheck
} from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils/cn"
import type { ChannelRow } from "@/types/database"
import { useAppStore } from "@/lib/stores/app-store"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { OptimizedAvatarImage } from "@/components/ui/optimized-avatar-image"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"
import { useToast } from "@/components/ui/use-toast"
import type { VoiceParticipant } from "@vortex/shared"

export type { VoiceParticipant }

/** Returns a short human-readable string for the time remaining until `expiresAt`. */
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

export function ChannelIcon({ channel, isVoiceActive }: { channel: ChannelRow; isVoiceActive: boolean }): React.ReactElement {
  const iconStyle = { color: isVoiceActive ? 'var(--theme-success)' : undefined }
  switch (channel.type) {
    case "voice":        return <Volume2 className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0" style={iconStyle} />
    case "forum":        return <MessageSquare className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0 tertiary-metadata" />
    case "stage":        return <Mic2 className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0" style={iconStyle} />
    case "announcement": return <Megaphone className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0 tertiary-metadata" />
    case "media":        return <Image className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0 tertiary-metadata" />
    default:             return <Hash className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0" />
  }
}

interface SortableChannelItemProps {
  channel: ChannelRow
  isActive: boolean
  isVoiceActive: boolean
  canManageChannels: boolean
  isDragging: boolean
  isUnread?: boolean
  mentionCount?: number
  activeThreadCount?: number
  voiceParticipants?: VoiceParticipant[]
  href?: string
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onCreateThread?: () => void
  onMarkRead?: () => void
  onOpenNotificationSettings: (channelId: string) => void
}

export function SortableChannelItem({
  channel,
  isActive,
  isVoiceActive,
  canManageChannels,
  isDragging,
  isUnread,
  mentionCount,
  activeThreadCount,
  voiceParticipants,
  href,
  onClick,
  onEdit,
  onDelete,
  onCreateThread,
  onMarkRead,
  onOpenNotificationSettings,
}: SortableChannelItemProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: channel.id })
  const router = useRouter()
  const { toast } = useToast()
  const notificationMode = useAppStore((s) => s.notificationModes[channel.id])
  const isMuted = notificationMode === "muted"
  const showBadge = !isActive && !isMuted && (isUnread || (mentionCount ?? 0) > 0)

  // Live countdown for ephemeral channels
  const [timeRemaining, setTimeRemaining] = useState<string | null>(
    channel.expires_at ? formatTimeRemaining(channel.expires_at) : null
  )
  useEffect(() => {
    if (!channel.expires_at) {
      setTimeRemaining(null)
      return
    }
    setTimeRemaining(formatTimeRemaining(channel.expires_at))
    const msRemaining = new Date(channel.expires_at).getTime() - Date.now()
    const delay = msRemaining <= 60_000 ? 1_000 : 30_000
    const interval = setInterval(() => {
      setTimeRemaining(formatTimeRemaining(channel.expires_at!))
    }, delay)
    return () => clearInterval(interval)
  }, [channel.expires_at])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/*
            Use a div with role="button" instead of a native <button> so the
            drag-handle span (which carries dnd-kit's event listeners) is not an
            interactive element nested inside another interactive element.
          */}
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
            {canManageChannels && (
              <span
                {...attributes}
                {...listeners}
                className="opacity-0 pointer-events-none group-hover/channel:opacity-100 group-hover/channel:pointer-events-auto group-focus-within/channel:opacity-100 group-focus-within/channel:pointer-events-auto touch-visible cursor-grab active:cursor-grabbing flex-shrink-0 -ml-1 touch-none"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="w-3 h-3 tertiary-metadata" />
              </span>
            )}
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
                <span
                  className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] font-bold px-1 channel-sidebar-mention-badge"
                >
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
            void navigator.clipboard
              .writeText(channel.id)
              .then(() => {
                toast({ title: "Channel ID copied!" })
              })
              .catch(() => {
                toast({ variant: "destructive", title: "Failed to copy channel ID" })
              })
          }}>
            <Clipboard className="w-4 h-4 mr-2" /> Copy Channel ID
          </ContextMenuItem>
          {canManageChannels && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onEdit}>
                <Pencil className="w-4 h-4 mr-2" /> Edit Channel
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete Channel
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Voice participants listed under voice channels */}
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
                {participant.muted && (
                  <MicOff className="w-3 h-3 flex-shrink-0 channel-sidebar-danger-icon" />
                )}
                {participant.deafened && (
                  <Headphones className="w-3 h-3 flex-shrink-0 channel-sidebar-danger-icon" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
