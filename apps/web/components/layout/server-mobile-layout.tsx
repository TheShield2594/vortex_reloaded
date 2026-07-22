"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft, Users, Search, MoreVertical, Sparkles, Briefcase, Pin, MessageSquareText } from "lucide-react"
import { useAppStore } from "@/lib/stores/app-store"
import type { MobileAction } from "@vortex/shared"
import { useShallow } from "zustand/react/shallow"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { useSwipe } from "@/hooks/use-swipe"

interface Props {
  serverId: string
  sidebar: React.ReactNode
  memberList: React.ReactNode
  children: React.ReactNode
}

/**
 * On mobile, switches between channel sidebar view and channel content view.
 * - /channels/:serverId → shows channel sidebar full-screen
 * - /channels/:serverId/:channelId → shows channel content full-screen with back button
 * On desktop, renders all panels inline.
 * On mobile channel view, the member list renders as an overlay panel on top of the content.
 */
export function ServerMobileLayout({ serverId, sidebar, memberList, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const isMobile = useMobileLayout()
  const { activeChannelId, channels, memberListOpen, setMemberListOpen, threadPanelOpen, toggleThreadPanel, workspaceOpen, toggleWorkspacePanel, setMobilePendingAction } = useAppStore(
    useShallow((s) => ({
      activeChannelId: s.activeChannelId,
      channels: s.channels,
      memberListOpen: s.memberListOpen,
      setMemberListOpen: s.setMemberListOpen,
      threadPanelOpen: s.threadPanelOpen,
      toggleThreadPanel: s.toggleThreadPanel,
      workspaceOpen: s.workspaceOpen,
      toggleWorkspacePanel: s.toggleWorkspacePanel,
      setMobilePendingAction: s.setMobilePendingAction,
    }))
  )

  // On mobile, use local state for the member list overlay so that entering
  // a channel always shows messages first. Desktop uses the persisted store value.
  const [mobileMemberListOpen, setMobileMemberListOpen] = useState(false)
  const [mobileOverflowOpen, setMobileOverflowOpen] = useState(false)
  const mobileOverflowRef = useRef<HTMLDivElement>(null)

  // Reset mobile member list whenever the channel route changes
  const routeChannelSegment = pathname.split("/").filter(Boolean)[2]
  useEffect(() => {
    if (isMobile) {
      setMobileMemberListOpen(false)
      setMemberListOpen(false)
    }
  }, [isMobile, routeChannelSegment, setMemberListOpen])

  // Sync local mobile state when the store is toggled externally
  // (e.g. chat-area header button, keyboard shortcut)
  useEffect(() => {
    if (isMobile) {
      setMobileMemberListOpen(memberListOpen)
    }
  }, [isMobile, memberListOpen])

  // Close mobile overflow menu on outside click
  useEffect(() => {
    if (!mobileOverflowOpen) return
    const handleClick = (e: PointerEvent) => {
      if (mobileOverflowRef.current && !mobileOverflowRef.current.contains(e.target as Node)) {
        setMobileOverflowOpen(false)
      }
    }
    document.addEventListener("pointerdown", handleClick)
    return () => document.removeEventListener("pointerdown", handleClick)
  }, [mobileOverflowOpen])

  // Close overflow when navigating
  useEffect(() => {
    setMobileOverflowOpen(false)
  }, [routeChannelSegment])

  // Determine if we are viewing a channel (not just the server root)
  const pathParts = pathname.split("/").filter(Boolean)
  // /channels/:serverId/:channelId = 3+ parts after split
  const isInChannel = pathParts.length >= 3 && pathParts[0] === "channels" && pathParts[1] === serverId && !!pathParts[2]
  // Special server sub-pages that aren't channels (settings, moderation, events)
  const specialPaths = ["settings", "moderation", "events"]
  const isSpecialPage = isInChannel && specialPaths.includes(pathParts[2])

  // Resolve the active channel — prefer the route param, fall back to store
  const routeChannelId = pathParts[2]
  const serverChannels = channels[serverId]
  const activeChannel = (() => {
    if (!serverChannels) return null
    if (routeChannelId) {
      const ch = serverChannels.find((c) => c.id === routeChannelId)
      if (ch) return ch
    }
    if (activeChannelId) {
      const ch = serverChannels.find((c) => c.id === activeChannelId)
      if (ch) return ch
    }
    return null
  })()
  const channelName = activeChannel?.name ?? (serverChannels ? "channel" : "")
  // Only show text-channel actions once channel data has loaded and confirmed text type.
  // When serverChannels is undefined the store hasn't hydrated yet — hide actions
  // rather than flashing them for non-text channel types.
  const isTextChannel = !!activeChannel && activeChannel.type === "text"

  // Helper to dismiss the mobile member list (both local and persisted state)
  const dismissMobileMemberList = useCallback((): void => {
    setMobileMemberListOpen(false)
    setMemberListOpen(false)
  }, [setMemberListOpen])

  // Swipe right to navigate back to the channel list on mobile
  const navigateBack = useCallback((): void => {
    // Don't navigate back if the member list is open (let it handle the swipe)
    if (mobileMemberListOpen) return
    router.push(`/channels/${serverId}`)
  }, [router, serverId, mobileMemberListOpen])

  // Swipe left to reveal the member list
  const revealMemberList = useCallback((): void => {
    // Don't reveal member list on special pages (settings/moderation/events)
    if (isSpecialPage) return
    if (!mobileMemberListOpen) {
      setMobileMemberListOpen(true)
      setMemberListOpen(true)
    }
  }, [mobileMemberListOpen, setMemberListOpen, isSpecialPage])

  const swipeHandlers = useSwipe({
    onSwipeRight: navigateBack,
    onSwipeLeft: revealMemberList,
    peekElementSelector: "[data-mobile-sidebar-peek]",
  })

  // Swipe right on the member list to dismiss it
  const memberListSwipeHandlers = useSwipe({
    onSwipeRight: dismissMobileMemberList,
    minDistance: 72,
  })

  // ========== DESKTOP LAYOUT — all panels inline ==========
  if (!isMobile) {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Channel sidebar */}
        <div className="flex-shrink-0 h-full">{sidebar}</div>
        {/* Channel content */}
        <main id="main-content" className="flex flex-1 overflow-hidden">
          {children}
        </main>
        {/* Member list */}
        {memberList}
      </div>
    )
  }

  // ========== MOBILE LAYOUT — shows sidebar OR content ==========
  // Read-state management lives in ChatArea (useMarkChannelRead), so the
  // sidebar can safely unmount when viewing channel content.
  if (isInChannel && !isSpecialPage) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden relative" {...swipeHandlers}>
        {/* Peek element: sidebar shadow shown during swipe-right gesture */}
        <div
          data-mobile-sidebar-peek=""
          className="absolute inset-y-0 left-0 w-[240px] -translate-x-full opacity-0 z-10 pointer-events-none"
          style={{ background: "var(--theme-bg-secondary)", boxShadow: "4px 0 16px rgba(0,0,0,0.3)" }}
          aria-hidden
        />
        {/* Single mobile channel header — combines navigation + channel actions */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-3 border-b flex-shrink-0"
          style={{
            background: "var(--theme-bg-secondary)",
            borderColor: "var(--theme-bg-tertiary)",
          }}
        >
          <button
            type="button"
            onClick={() => router.push(`/channels/${serverId}`)}
            className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15 flex-shrink-0"
            style={{ color: "var(--theme-text-secondary)" }}
            aria-label="Back to channels"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span
            className="flex-1 text-base font-semibold truncate min-w-0"
            style={{ color: "var(--theme-text-primary)" }}
          >
            # {channelName}
          </span>

          {/* Inline action icons — search only shown for text channels (ChatArea) */}
          {isTextChannel && (
            <button
              type="button"
              onClick={() => { dismissMobileMemberList(); setMobilePendingAction("search") }}
              className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15 flex-shrink-0"
              style={{ color: "var(--theme-text-secondary)" }}
              aria-label="Search messages"
            >
              <Search className="w-[18px] h-[18px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMobileMemberListOpen((v) => {
                const next = !v
                setMemberListOpen(next)
                return next
              })
            }}
            className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15 flex-shrink-0"
            style={{ color: mobileMemberListOpen ? "var(--theme-accent)" : "var(--theme-text-secondary)" }}
            aria-label="Toggle member list"
          >
            <Users className="w-[18px] h-[18px]" />
          </button>

          {/* Overflow menu — only shown for text channels where ChatArea handles the events */}
          {isTextChannel && (
            <div className="relative flex-shrink-0" ref={mobileOverflowRef}>
              <button
                type="button"
                onClick={() => setMobileOverflowOpen((v) => !v)}
                className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15"
                style={{ color: "var(--theme-text-secondary)" }}
                aria-label="More channel actions"
                aria-expanded={mobileOverflowOpen}
                aria-haspopup="menu"
              >
                <MoreVertical className="w-[18px] h-[18px]" />
              </button>
              {mobileOverflowOpen && (
                <div
                  role="menu"
                  aria-label="Channel actions"
                  className="absolute right-0 top-10 z-50 min-w-52 rounded-lg border p-1 shadow-xl"
                  style={{
                    background: "var(--theme-bg-secondary)",
                    borderColor: "var(--theme-bg-tertiary)",
                  }}
                >
                  {([
                    { id: "summary" as const, label: "AI Summary", icon: <Sparkles className="w-4 h-4" /> },
                    { id: "workspace" as const, label: "Workspace", icon: <Briefcase className="w-4 h-4" />, active: workspaceOpen },
                    { id: "pins" as const, label: "Pinned Messages", icon: <Pin className="w-4 h-4" /> },
                    { id: "threads" as const, label: "Threads", icon: <MessageSquareText className="w-4 h-4" />, active: threadPanelOpen },
                  ] satisfies Array<{ id: MobileAction | "workspace" | "threads"; label: string; icon: React.ReactNode; active?: boolean }>).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMobileOverflowOpen(false)
                        dismissMobileMemberList()
                        if (item.id === "workspace") {
                          toggleWorkspacePanel()
                        } else if (item.id === "threads") {
                          toggleThreadPanel()
                        } else {
                          setMobilePendingAction(item.id)
                        }
                      }}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-white/10"
                      style={{ color: item.active ? "var(--theme-accent)" : "var(--theme-text-primary)" }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Channel content */}
        <main id="main-content" className="flex flex-1 overflow-hidden relative">
          {children}
          {/* Member list stays mounted for @mention store sync; visibility toggled via CSS */}
          {mobileMemberListOpen && (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
            <div
              className="absolute inset-0 z-10 bg-black/50"
              onClick={dismissMobileMemberList}
              aria-hidden="true"
            />
          )}
          <div
            className={`absolute inset-y-0 right-0 z-20 w-[280px] max-w-[85vw] overflow-hidden shadow-xl transition-transform ${
              mobileMemberListOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
            }`}
            style={{ background: "var(--theme-bg-secondary)" }}
            aria-hidden={mobileMemberListOpen ? undefined : "true"}
            {...memberListSwipeHandlers}
          >
            {memberList}
          </div>
        </main>
      </div>
    )
  }

  if (isSpecialPage) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" {...swipeHandlers}>
        {/* Special pages (settings/moderation/events) */}
        <div
          className="flex items-center gap-2 px-2.5 py-3 border-b flex-shrink-0"
          style={{
            background: "var(--theme-bg-secondary)",
            borderColor: "var(--theme-bg-tertiary)",
          }}
        >
          <button
            type="button"
            onClick={() => router.push(`/channels/${serverId}`)}
            className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15"
            style={{ color: "var(--theme-text-secondary)" }}
            aria-label="Back to server"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold capitalize" style={{ color: "var(--theme-text-primary)" }}>
            {pathParts[2]}
          </span>
        </div>
        <main id="main-content" className="flex flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    )
  }

  // Channel sidebar shown full-screen on mobile with push-in animation
  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-slide-in-from-right">
      <div className="flex-1 overflow-hidden">{sidebar}</div>
    </div>
  )
}