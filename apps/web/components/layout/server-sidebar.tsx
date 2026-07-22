"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Compass, Clipboard, LogOut, UserPlus, Bell, BellOff } from "lucide-react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/context-menu"
import { useToast } from "@/components/ui/use-toast"
import { CreateServerModal } from "@/components/modals/create-server-modal"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useState, useMemo, useCallback, useEffect } from "react"
import { perfMarkNavStart } from "@/lib/perf"
import { cn } from "@/lib/utils/cn"
import type { ServerRow } from "@/types/database"
import { VortexLogo } from "@/components/ui/vortex-logo"
import { Skeleton } from "@/components/ui/skeleton"
import { NotificationSettingsModal } from "@/components/modals/notification-settings-modal"
import Image from "next/image"
import { useMobileLayout } from "@/hooks/use-mobile-layout"

/** Vertical icon strip listing joined servers, DM shortcut, and create/discover actions. */
export function ServerSidebar() {
  const { servers, isLoadingServers, activeServerId, setActiveServer, removeServer, currentUser, channels, serverHasUnread } = useAppStore(
    useShallow((s) => ({ servers: s.servers, isLoadingServers: s.isLoadingServers, activeServerId: s.activeServerId, setActiveServer: s.setActiveServer, removeServer: s.removeServer, currentUser: s.currentUser, channels: s.channels, serverHasUnread: s.serverHasUnread }))
  )
  const [showCreateServer, setShowCreateServer] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const isMobile = useMobileLayout()
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  const navigateToServer = useCallback((serverId: string) => {
    perfMarkNavStart(`server:${serverId.slice(0, 8)}`)
    setActiveServer(serverId)

    // On mobile, go to the server root so the channel sidebar is shown full-screen
    if (isMobile) {
      router.push(`/channels/${serverId}`)
      return
    }

    // Check Zustand store for cached channels (populated after any visit this session)
    const cached = channels[serverId]
    if (cached && cached.length > 0) {
      const firstText = [...cached]
        .filter((c) => c.type === "text")
        .sort((a, b) => a.position - b.position)[0]
      if (firstText) {
        router.push(`/channels/${serverId}/${firstText.id}`)
        return
      }
    }

    // Check localStorage for last-visited channel (cross-session)
    try {
      const stored = localStorage.getItem(`vortexchat:last-channel:${serverId}`)
      if (stored) {
        router.push(`/channels/${serverId}/${stored}`)
        return
      }
    } catch {}

    // Fallback: redirect page handles first-ever visit
    router.push(`/channels/${serverId}`)
  }, [channels, isMobile, router, setActiveServer])

  async function handleLeaveServer(server: ServerRow) {
    if (!currentUser) return
    try {
      const { error } = await supabase
        .from("server_members")
        .delete()
        .eq("server_id", server.id)
        .eq("user_id", currentUser.id)
      if (error) throw error
      removeServer(server.id)
      toast({ title: `Left ${server.name}` })
      router.push("/channels/me")
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to leave server", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Servers"
        className="flex flex-col items-center w-[80px] md:w-[72px] py-3 gap-3 md:gap-2 flex-shrink-0 overflow-y-auto no-scrollbar"
        style={{
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--theme-accent) 8%, var(--theme-bg-tertiary)) 0%, var(--theme-bg-tertiary) 30%)',
        }}
      >
        {/* VortexChat home / Direct Messages */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/channels/me"
              onClick={() => setActiveServer(null)}
              aria-label="Direct Messages"
              className={cn(
                "w-[52px] h-[52px] md:w-12 md:h-12 flex items-center justify-center cursor-pointer transition-all duration-200 focus-ring",
                activeServerId === null
                  ? "rounded-2xl"
                  : "rounded-full hover:rounded-2xl"
              )}
              style={{
                background: activeServerId === null
                  ? 'color-mix(in srgb, var(--theme-accent) 20%, var(--theme-bg-primary))'
                  : 'var(--theme-bg-primary)',
              }}
            >
              <VortexLogo size={32} />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Direct Messages</TooltipContent>
        </Tooltip>

        <Separator className="w-8 my-1" style={{ background: 'var(--theme-surface-elevated)' }} />

        {/* Server list */}
        {servers.length === 0 && isLoadingServers && (
          <div className="w-full flex flex-col items-center gap-2 py-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-[52px] w-[52px] md:h-12 md:w-12 rounded-full" />
            ))}
          </div>
        )}

        {servers.length === 0 && !isLoadingServers && (
          <div className="flex flex-col items-center gap-1 py-2 px-1">
            <span className="text-[10px] text-center leading-tight font-medium" style={{ color: "var(--theme-text-muted)" }}>
              No servers yet
            </span>
          </div>
        )}

        {servers.map((server) => (
          <ServerIcon
            key={server.id}
            server={server}
            isActive={activeServerId === server.id}
            isOwner={currentUser?.id === server.owner_id}
            hasUnread={serverHasUnread[server.id] ?? false}
            onClick={() => navigateToServer(server.id)}
            onLeave={() => handleLeaveServer(server)}
          />
        ))}

        <Separator className="w-8 my-1" style={{ background: 'var(--theme-surface-elevated)' }} />

        {/* Add server — primary action: accent color, pulse when no servers */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowCreateServer(true)}
              aria-label="Add a Server"
              className={cn(
                "w-[52px] h-[52px] md:w-12 md:h-12 rounded-full hover:rounded-2xl flex items-center justify-center cursor-pointer transition-all duration-200 group focus-ring",
                servers.length === 0 && !isLoadingServers && "ring-2 ring-offset-2 animate-pulse"
              )}
              style={{
                background: servers.length === 0 && !isLoadingServers ? 'var(--theme-accent)' : 'var(--theme-bg-primary)',
                ...(servers.length === 0 && !isLoadingServers ? { ringColor: 'var(--theme-accent)', ringOffsetColor: 'var(--theme-bg-tertiary)' } : {}),
              }}
            >
              <Plus className="w-6 h-6 transition-colors" style={{ color: servers.length === 0 && !isLoadingServers ? 'white' : 'var(--theme-accent)' }} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{servers.length === 0 ? "Create Your First Server" : "Add a Server"}</TooltipContent>
        </Tooltip>

        {/* Explore — secondary action: muted color */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/channels/discover"
              prefetch
              onClick={() => setActiveServer(null)}
              aria-label="Explore Public Servers"
              className="w-[52px] h-[52px] md:w-12 md:h-12 rounded-full hover:rounded-2xl flex items-center justify-center cursor-pointer transition-all duration-200 focus-ring"
              style={{ background: 'var(--theme-bg-primary)' }}
            >
              <Compass className="w-6 h-6" style={{ color: 'var(--theme-text-muted)' }} />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Explore Public Servers</TooltipContent>
        </Tooltip>

        <CreateServerModal
          open={showCreateServer}
          onClose={() => setShowCreateServer(false)}
        />
      </nav>
    </TooltipProvider>
  )
}

function ServerIcon({
  server,
  isActive,
  isOwner,
  hasUnread,
  onClick,
  onLeave,
}: {
  server: ServerRow
  isActive: boolean
  isOwner: boolean
  hasUnread: boolean
  onClick: () => void
  onLeave: () => void
}) {
  const { toast } = useToast()
  const notificationMode = useAppStore((s) => s.notificationModes[server.id])
  const isMuted = notificationMode === "muted"
  const [showNotifSettings, setShowNotifSettings] = useState(false)
  const initials = server.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const [copyShortcutLabel, setCopyShortcutLabel] = useState<string | null>(null)

  useEffect(() => {
    const platform = navigator.userAgentData?.platform ?? navigator.userAgent ?? ""
    const isApple = /Mac|iPhone|iPad|iPod/i.test(platform)
    setCopyShortcutLabel(isApple ? "⌘C" : "Ctrl+C")
  }, [])

  return (
    <>
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <Link href={`/channels/${server.id}`} prefetch className="relative group cursor-pointer focus-ring rounded-full block" aria-label={server.name} onClick={(e) => { e.preventDefault(); onClick() }}>
              {/* Active indicator */}
              <div
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all duration-200",
                  isActive
                    ? "h-10 w-1.5 -left-3"
                    : hasUnread
                      ? "h-7 w-1 -left-3 opacity-90"
                      : "h-5 w-1 -left-3 opacity-0 group-hover:opacity-100 group-hover:h-5",
                  isActive ? "server-sidebar-active-indicator" : "server-sidebar-unread-indicator"
                )}
              />
              <div
                className={cn(
                  "relative w-[52px] h-[52px] md:w-12 md:h-12 flex items-center justify-center transition-all duration-200 overflow-hidden",
                  isActive ? "rounded-2xl" : "rounded-full hover:rounded-2xl",
                  server.icon_url ? "bg-transparent" : "server-sidebar-icon-bg",
                  isActive
                    ? "server-sidebar-icon-active"
                    : hasUnread
                      ? "server-sidebar-icon-unread"
                      : ""
                )}
              >
                {server.icon_url ? (
                  <Image
                    src={server.icon_url}
                    alt={server.name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <span className="text-sm font-semibold server-sidebar-initials">{initials}</span>
                )}
              </div>

              {/* Muted indicator */}
              {isMuted && (
                <div className="absolute -bottom-0.5 -right-0.5 w-[16px] h-[16px] rounded-full flex items-center justify-center pointer-events-none" style={{ background: "var(--theme-bg-tertiary)" }}>
                  <BellOff className="w-2.5 h-2.5" style={{ color: "var(--theme-text-muted)" }} />
                </div>
              )}

              {/* Unread pip — shown when the server has unread channels and is not active/muted */}
              {hasUnread && !isActive && !isMuted && (
                <div
                  className="absolute -bottom-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full border-2 pointer-events-none server-sidebar-unread-pip"
                />
              )}
            </Link>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{server.name}</TooltipContent>
      </Tooltip>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => setShowNotifSettings(true)}>
          <Bell className="w-4 h-4 mr-2" /> Notification Settings
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={async () => {
          try {
            await navigator.clipboard.writeText(server.invite_code)
            toast({ title: "Invite code copied!" })
          } catch { /* clipboard unavailable */ }
        }}>
          <UserPlus className="w-4 h-4 mr-2" /> Invite People
          <ContextMenuShortcut>I</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={async () => {
          try {
            await navigator.clipboard.writeText(server.id)
            toast({ title: "Server ID copied!" })
          } catch { /* clipboard unavailable */ }
        }}>
          <Clipboard className="w-4 h-4 mr-2" /> Copy Server ID
          {copyShortcutLabel && <ContextMenuShortcut>{copyShortcutLabel}</ContextMenuShortcut>}
        </ContextMenuItem>
        {!isOwner && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={onLeave}>
              <LogOut className="w-4 h-4 mr-2" /> Leave Server
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>

    <NotificationSettingsModal
      open={showNotifSettings}
      onClose={() => setShowNotifSettings(false)}
      serverId={server.id}
      label={server.name}
    />
    </>
  )
}
