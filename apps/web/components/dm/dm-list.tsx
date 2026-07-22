"use client"

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Users, Plus, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils/cn"
import { format, isToday } from "date-fns"
import { Skeleton, ChannelRowSkeleton } from "@/components/ui/skeleton"
import { BrandedEmptyState } from "@/components/ui/branded-empty-state"
import { toast } from "@/components/ui/use-toast"
import { useAppStore } from "@/lib/stores/app-store"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FriendsSidebar } from "./friends-sidebar"
import type { FriendWithUser } from "@/types/database"

interface DMChannel {
  id: string
  name: string | null
  icon_url: string | null
  is_group: boolean
  updated_at: string
  is_unread: boolean
  is_encrypted?: boolean
  latest_message: { content: string; created_at: string } | null
  partner: {
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
    status: string
  } | null
  members: Array<{
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
  }>
}

function formatTime(ts: string) {
  const d = new Date(ts)
  return isToday(d) ? format(d, "h:mm a") : format(d, "MMM d")
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "var(--theme-success)",
    idle: "var(--theme-warning)",
    dnd: "var(--theme-danger)",
    offline: "var(--theme-presence-offline)",
    invisible: "var(--theme-presence-offline)",
  }
  return (
    <span
      className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
      style={{ background: colors[status] ?? "var(--theme-presence-offline)", borderColor: "var(--theme-bg-secondary)" }}
    />
  )
}

interface NewDmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectFriend: (friendId: string) => Promise<boolean>
}

function NewDmDialog({ open, onOpenChange, onSelectFriend }: NewDmDialogProps) {
  const [friends, setFriends] = useState<FriendWithUser[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingFriendId, setPendingFriendId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch("/api/friends")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login"
          return { accepted: [] }
        }
        return r.ok ? r.json() : { accepted: [] }
      })
      .then((data) => setFriends(data.accepted ?? []))
      .catch(() => { /* network failure — ignore */ })
      .finally(() => setLoading(false))
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Direct Message</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : friends.length === 0 ? (
          <p className="text-sm text-center py-6 text-muted-foreground">
            No friends yet. Add friends to start a DM.
          </p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {friends.map((entry) => {
              const { friend } = entry
              const displayName = friend.display_name || friend.username
              const initials = displayName.slice(0, 2).toUpperCase()
              return (
                <button
                  key={entry.id}
                  disabled={pendingFriendId !== null}
                  onClick={async () => {
                    setPendingFriendId(friend.id)
                    try {
                      if (await onSelectFriend(friend.id)) onOpenChange(false)
                    } finally {
                      setPendingFriendId(null)
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg interactive-list-item surface-hover text-left disabled:opacity-50"
                >
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    {friend.avatar_url && <AvatarImage src={friend.avatar_url} />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    {friend.username !== displayName && (
                      <p className="text-xs text-muted-foreground truncate">@{friend.username}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type DMTab = "messages" | "friends"

/** Sidebar list of DM conversations with unread indicators, last-message previews, and real-time channel updates. */
export function DMList({ onNavigate }: { onNavigate?: () => void } = {}) {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get("tab") === "friends" ? "friends" : "messages"
  const [activeTab, setActiveTab] = useState<DMTab>(initialTab)

  // Keep activeTab in sync with URL search params
  useEffect(() => {
    const tab: DMTab = searchParams.get("tab") === "friends" ? "friends" : "messages"
    setActiveTab(tab)
  }, [searchParams])
  const [channels, setChannels] = useState<DMChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [newDmOpen, setNewDmOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const currentUserId = useAppStore((state) => state.currentUser?.id)
  const inFlightRefreshRef = useRef<Promise<void> | null>(null)

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/dm/channels")
      if (res.status === 401) {
        window.location.href = "/login"
        return
      }
      if (res.ok) {
        const data = await res.json()
        setChannels(data)
        // Push DM unread count to store (consumed by useTabUnreadTitle)
        const unread = (data as DMChannel[]).filter((ch) => ch.is_unread).length
        useAppStore.getState().setDmUnreadCount(unread)
      }
    } catch {
      // Network failure (e.g. "Load failed" on Mobile Safari when backgrounded)
      // — silently ignore; channels will refresh on next successful fetch
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshChannels = useCallback(() => {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current

    const task = fetchChannels().finally(() => {
      inFlightRefreshRef.current = null
    })
    inFlightRefreshRef.current = task
    return task
  }, [fetchChannels])

  useEffect(() => {
    refreshChannels()
  }, [refreshChannels])

  const channelIdsStr = useMemo(() => {
    return channels.map((channel) => channel.id).sort().join(",")
  }, [channels])

  // Refresh list when DM messages or membership changes happen
  useEffect(() => {
    if (!currentUserId) return

    let cancelled = false

    const dmMessageFilter = channelIdsStr
      ? `dm_channel_id=in.(${channelIdsStr})`
      : `sender_id=eq.${currentUserId}`

    // Use a random name so we never collide with a channel that is still
    // being torn down asynchronously by a previous effect cleanup.
    const ch = supabase
      .channel(`dm-list-updates:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: dmMessageFilter },
        () => {
          if (!cancelled) refreshChannels()
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_channel_members", filter: `user_id=eq.${currentUserId}` },
        () => { if (!cancelled) refreshChannels() }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "dm_channel_members", filter: `user_id=eq.${currentUserId}` },
        () => { if (!cancelled) refreshChannels() }
      )
      .subscribe()
    return () => {
      cancelled = true
      supabase.removeChannel(ch)
    }
  }, [supabase, refreshChannels, channelIdsStr, currentUserId])

  async function startDM(friendId: string): Promise<boolean> {
    try {
      const res = await fetch("/api/dm/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [friendId] }),
      })
      if (res.ok) {
        const { id } = await res.json()
        router.push(`/channels/me/${id}`)
        onNavigate?.()
        refreshChannels()
        return true
      }
      const body = await res.json().catch(() => ({}))
      toast({
        variant: "destructive",
        title: "Could not start conversation",
        description: body.error || "Something went wrong. Please try again.",
      })
      return false
    } catch {
      toast({
        variant: "destructive",
        title: "Could not start conversation",
        description: "Network error. Please check your connection.",
      })
      return false
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col px-2 pt-3" aria-busy="true" aria-label="Loading direct messages">
        <Skeleton className="mb-3 h-3 w-28" />
        <div className="skeleton-stagger space-y-0.5">
          {Array.from({ length: 7 }).map((_, index) => (
            <ChannelRowSkeleton key={index} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <NewDmDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        onSelectFriend={startDM}
      />

      {/* Segmented header: Messages / Friends */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div
          className="flex flex-1 rounded-md p-0.5"
          style={{ background: "var(--theme-bg-tertiary)" }}
        >
          {(["messages", "friends"] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => {
                setActiveTab(tab)
                const params = new URLSearchParams(searchParams.toString())
                if (tab === "friends") {
                  params.set("tab", "friends")
                } else {
                  params.delete("tab")
                }
                const query = params.toString()
                router.push(`${pathname}${query ? `?${query}` : ""}`)
              }}
              className={cn(
                "flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-colors capitalize",
                activeTab === tab
                  ? "text-white"
                  : "hover:text-white/70"
              )}
              style={{
                background: activeTab === tab ? "var(--theme-bg-secondary)" : "transparent",
                color: activeTab === tab ? "var(--theme-text-primary)" : "var(--theme-text-muted)",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        {activeTab === "messages" && (
          <button
            type="button"
            onClick={() => setNewDmOpen(true)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors flex-shrink-0"
            style={{ color: "var(--theme-text-muted)" }}
            title="New DM"
            aria-label="New direct message"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "friends" ? (
        <div className="flex-1 overflow-hidden">
          <FriendsSidebar compact onStartDM={startDM} />
        </div>
      ) : (
        /* Channel list */
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {channels.length === 0 && (
            <div className="px-2 py-4 space-y-3">
              <BrandedEmptyState
                icon={Users}
                title="Your DMs are quiet"
                description="Start a new conversation to see your messages, status updates, and call history here."
                hint="Tip: Right-click a member and choose Message to open a DM."
              />
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("friends")
                    const params = new URLSearchParams(searchParams.toString())
                    params.set("tab", "friends")
                    router.push(`${pathname}?${params.toString()}`)
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: "var(--theme-accent)", color: "white" }}
                >
                  <Users className="w-4 h-4" />
                  Find People
                </button>
                <button
                  type="button"
                  onClick={() => setNewDmOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)" }}
                >
                  <Plus className="w-4 h-4" />
                  New Message
                </button>
              </div>
            </div>
          )}
          {channels.map((ch) => {
            const isActive = pathname === `/channels/me/${ch.id}`
            const displayName = ch.is_group
              ? (ch.name || ch.members.map((m) => m.display_name || m.username).join(", "))
              : (ch.partner?.display_name || ch.partner?.username || "Unknown")
            const initials = displayName.slice(0, 2).toUpperCase()

            return (
              <button
                type="button"
                key={ch.id}
                onClick={() => { router.push(`/channels/me/${ch.id}`); onNavigate?.() }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 md:px-2 py-2.5 md:py-1.5 rounded-md text-left interactive-list-item",
                  isActive
                    ? "motion-selected text-white"
                    : "surface-hover text-gray-400 hover:text-gray-200"
                )}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  {ch.is_group ? (
                    <div
                      className="w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center"
                      style={{ background: "var(--theme-accent)" }}
                    >
                      <Users className="w-5 h-5 md:w-4 md:h-4 text-white" />
                    </div>
                  ) : (
                    <Avatar className="w-10 h-10 md:w-8 md:h-8">
                      {ch.partner?.avatar_url && <AvatarImage src={ch.partner.avatar_url} />}
                      <AvatarFallback style={{ background: "var(--theme-accent)", color: "white", fontSize: "11px" }}>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {!ch.is_group && ch.partner && (
                    <StatusDot status={ch.partner.status} />
                  )}
                </div>

                {/* Name + preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn("text-sm font-medium truncate", ch.is_unread && !isActive ? "text-white" : "")}
                    >
                      {displayName}{ch.is_encrypted ? " 🔒" : ""}
                    </span>
                    {ch.latest_message && (
                      <span className="text-xs flex-shrink-0" style={{ color: "var(--theme-text-faint)" }}>
                        {formatTime(ch.latest_message.created_at)}
                      </span>
                    )}
                  </div>
                  {ch.latest_message && (
                    <p className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>
                      {ch.latest_message.content}
                    </p>
                  )}
                </div>

                {/* Unread dot */}
                {ch.is_unread && !isActive && (
                  <>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" aria-hidden="true" style={{ background: "var(--theme-accent)" }} />
                    <span className="sr-only">Unread messages</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
