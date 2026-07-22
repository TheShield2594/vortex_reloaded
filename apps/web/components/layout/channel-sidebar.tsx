"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { perfLogSinceNav } from "@/lib/perf"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  Plus, CalendarDays,
} from "lucide-react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { cn } from "@/lib/utils/cn"
import type { ChannelRow, RoleRow, ServerRow } from "@/types/database"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { markChannelRead, markChannelReadRpc } from "@/lib/mark-channel-read"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import dynamic from "next/dynamic"
import { UserPanel } from "@/components/layout/user-panel"
import { CompactVoiceBar } from "@/components/voice/compact-voice-bar"
import { SortableChannelItem, ChannelIcon } from "@/components/layout/sortable-channel-item"
import { CategoryHeader, DropContainer, getCategoryDragId, getCategoryIdFromDragId } from "@/components/layout/category-header"
import { StaticCategoryHeader, StaticChannelItem } from "@/components/layout/static-channel-list"

import type { VoiceParticipant } from "@vortex/shared"
export type { VoiceParticipant }

const CreateChannelModal = dynamic(() => import("@/components/modals/create-channel-modal").then((m) => ({ default: m.CreateChannelModal })))
const EditChannelModal = dynamic(() => import("@/components/modals/edit-channel-modal").then((m) => ({ default: m.EditChannelModal })))
const ServerSettingsModal = dynamic(() => import("@/components/modals/server-settings-modal").then((m) => ({ default: m.ServerSettingsModal })))
const QuickSwitcherModal = dynamic(() => import("@/components/modals/quickswitcher-modal").then((m) => ({ default: m.QuickSwitcherModal })))
const NotificationSettingsModal = dynamic(() => import("@/components/modals/notification-settings-modal").then((m) => ({ default: m.NotificationSettingsModal })))
const SearchModal = dynamic(() => import("@/components/modals/search-modal").then((m) => ({ default: m.SearchModal })))
const KeyboardShortcutsModal = dynamic(() => import("@/components/modals/keyboard-shortcuts-modal").then((m) => ({ default: m.KeyboardShortcutsModal })))
const TransparencyPanel = dynamic(() => import("@/components/admin/transparency-panel").then((m) => ({ default: m.TransparencyPanel })))
import { PERMISSIONS, hasPermission } from "@vortex/shared"
import { useUnreadChannels } from "@/hooks/use-unread-channels"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { useKeyboardShortcuts, type ShortcutHandlers } from "@/hooks/use-keyboard-shortcuts"

const NO_CATEGORY = "__no_category__"
const MAX_AUTO_EXPANDED_CATEGORIES = 18

/** Channel types that support messaging (messages table) */
const MESSAGE_CHANNEL_TYPES = ["text", "announcement", "forum", "media"] as const

/** Channel types that use voice infrastructure */
const VOICE_CHANNEL_TYPES = ["voice", "stage"] as const

interface Props {
  server: ServerRow
  channels: ChannelRow[]
  currentUserId: string
  isOwner: boolean
  userRoles: RoleRow[]
  initialThreadCounts?: Record<string, number>
  initialVoiceParticipants?: VoiceParticipant[]
  initialUnreadChannelIds?: string[]
  initialMentionCounts?: Record<string, number>
}

type GroupedChannels = {
  category: ChannelRow | null
  channels: ChannelRow[]
}[]


function groupChannels(channels: ChannelRow[]): GroupedChannels {
  const sorted = [...channels].sort((a, b) => a.position - b.position)
  const categories = sorted.filter((c) => c.type === "category")
  const noCategory = sorted.filter((c) => c.type !== "category" && !c.parent_id)

  const result: GroupedChannels = []

  if (noCategory.length > 0 || categories.length === 0) {
    result.push({ category: null, channels: noCategory })
  }

  for (const cat of categories) {
    const children = sorted.filter(
      (c) => c.parent_id === cat.id && c.type !== "category"
    )
    result.push({ category: cat, channels: children })
  }

  return result
}

function buildItems(grouped: GroupedChannels): Record<string, string[]> {
  const items: Record<string, string[]> = {}
  for (const { category, channels } of grouped) {
    const key = category?.id ?? NO_CATEGORY
    items[key] = channels.map((c) => c.id)
  }
  return items
}

function buildContainerIndex(items: Record<string, string[]>): Record<string, string> {
  const index: Record<string, string> = {}
  for (const [containerId, channelIds] of Object.entries(items)) {
    for (const channelId of channelIds) {
      index[channelId] = containerId
    }
  }
  return index
}

export function getAutoExpandedCategoryIds(
  channels: ChannelRow[],
  activeChannelId: string | null,
  unreadChannelIds: Set<string>,
  voiceChannelId: string | null
): Set<string> {
  const ranked = new Set<string>()

  const addCategoryId = (channelId: string | null | undefined) => {
    if (!channelId) return
    const channel = channels.find((item) => item.id === channelId)
    if (!channel?.parent_id) return
    ranked.add(channel.parent_id)
  }

  addCategoryId(activeChannelId)
  addCategoryId(voiceChannelId)

  for (const channelId of unreadChannelIds) {
    addCategoryId(channelId)
    if (ranked.size >= MAX_AUTO_EXPANDED_CATEGORIES) break
  }

  return new Set(Array.from(ranked).slice(0, MAX_AUTO_EXPANDED_CATEGORIES))
}

export function resolveExpandedCategoryIds(
  categoryIds: string[],
  autoExpandedCategoryIds: Set<string>,
  manualOverrides: Record<string, boolean>
): Set<string> {
  const expanded = new Set<string>()

  for (const categoryId of categoryIds) {
    if (manualOverrides[categoryId] === false) continue
    if (manualOverrides[categoryId] === true || autoExpandedCategoryIds.has(categoryId)) {
      expanded.add(categoryId)
    }
  }

  return expanded
}

/**
 * Merge incoming channel data into the current drag-ordered items.
 * - Preserves the existing display order within each container.
 * - Appends channels that arrived while dragging to the end of their container.
 * - Removes channels that were deleted while dragging.
 */
function mergeItemsPreservingOrder(
  prev: Record<string, string[]>,
  next: Record<string, string[]>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {}
  const allContainers = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const containerId of allContainers) {
    const prevIds = prev[containerId] ?? []
    const nextIds = next[containerId] ?? []
    const nextSet = new Set(nextIds)
    const kept = prevIds.filter((id) => nextSet.has(id))
    const keptSet = new Set(kept)
    const added = nextIds.filter((id) => !keptSet.has(id))
    merged[containerId] = [...kept, ...added]
  }
  return merged
}

export function normalizeVoiceParticipants(rows: Array<Record<string, unknown>>): VoiceParticipant[] {
  return rows.map((d: Record<string, unknown>) => ({
    user_id: d.user_id as string,
    channel_id: d.channel_id as string,
    muted: d.muted as boolean,
    deafened: d.deafened as boolean,
    user: (d.users as VoiceParticipant["user"]) ?? null,
  }))
}

async function fetchThreadCounts(serverId: string, signal: AbortSignal) {
  const response = await fetch(`/api/threads/counts?serverId=${serverId}`, { signal })
  if (!response.ok) return null
  const data = await response.json()
  return data && typeof data === "object" ? data as Record<string, number> : null
}

/** Server channel sidebar with drag-and-drop reordering, category grouping, voice state indicators, and unread tracking. */
export function ChannelSidebar({ server, channels: initialChannels, currentUserId, isOwner, userRoles, initialThreadCounts, initialVoiceParticipants, initialUnreadChannelIds, initialMentionCounts }: Props) {
  const { activeChannelId, voiceChannelId, setVoiceChannel, channels: storeChannels, setChannels, addChannel, updateChannel, removeChannel, toggleMemberList, toggleThreadPanel, toggleWorkspacePanel, setServerHasUnread } = useAppStore(
    useShallow((s) => ({ activeChannelId: s.activeChannelId, voiceChannelId: s.voiceChannelId, setVoiceChannel: s.setVoiceChannel, channels: s.channels, setChannels: s.setChannels, addChannel: s.addChannel, updateChannel: s.updateChannel, removeChannel: s.removeChannel, toggleMemberList: s.toggleMemberList, toggleThreadPanel: s.toggleThreadPanel, toggleWorkspacePanel: s.toggleWorkspacePanel, setServerHasUnread: s.setServerHasUnread }))
  )
  const [categoryExpansionOverrides, setCategoryExpansionOverridesRaw] = useState<Record<string, boolean>>({})

  // Hydrate category expansion state from localStorage after mount to avoid
  // SSR/client mismatch (React Error #418). The server always renders with
  // all categories expanded ({}); localStorage values are applied after hydration.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`vortexchat:category-expansion:${server.id}`)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setCategoryExpansionOverridesRaw(parsed as Record<string, boolean>)
        }
      }
    } catch {
      // best effort
    }
  }, [server.id])
  const setCategoryExpansionOverrides: typeof setCategoryExpansionOverridesRaw = (action) => {
    setCategoryExpansionOverridesRaw((prev) => {
      const next = typeof action === "function" ? action(prev) : action
      try { window.localStorage.setItem(`vortexchat:category-expansion:${server.id}`, JSON.stringify(next)) } catch { /* best effort */ }
      return next
    })
  }
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showServerSettings, setShowServerSettings] = useState(false)
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | undefined>()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, string[]>>({})
  const [overContainerId, setOverContainerId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [editTarget, setEditTarget] = useState<ChannelRow | null>(null)
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<{ id: string; name: string } | null>(null)
  const [editCategoryTarget, setEditCategoryTarget] = useState<ChannelRow | null>(null)
  const [notifSettingsChannelId, setNotifSettingsChannelId] = useState<string | null>(null)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [transparencyTarget, setTransparencyTarget] = useState<{ serverId: string; channelId: string } | null>(null)
  const [activeThreadCounts, setActiveThreadCounts] = useState<Record<string, number>>(initialThreadCounts ?? {})
  const router = useRouter()
  const { toast } = useToast()

  // Always reflects the latest committed items — used in drag handlers to avoid stale closures
  const itemsRef = useRef<Record<string, string[]>>({})
  itemsRef.current = items
  const containerIndexRef = useRef<Record<string, string>>({})
  const isDraggingRef = useRef(false)
  isDraggingRef.current = activeId !== null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // When dragging a category, only consider other category sortables as drop
  // targets. Without this, closestCenter picks up channel items (which are
  // physically closer) and the SortableContext for categories never sees a
  // valid "over" peer — so visual reordering and the handleDragEnd category
  // branch both fail.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const draggedId = args.active.id as string
    if (getCategoryIdFromDragId(draggedId)) {
      const categoryOnly = args.droppableContainers.filter(
        (container) => getCategoryIdFromDragId(container.id as string) !== null
      )
      return closestCenter({ ...args, droppableContainers: categoryOnly })
    }
    return closestCenter(args)
  }, [])

  // Perf: log mount time relative to navigation start
  useEffect(() => {
    perfLogSinceNav("ChannelSidebar mounted")
  }, [server.id])

  // Listen for transparency report open event from channel context menu
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ serverId: string; channelId: string }>).detail
      if (detail?.serverId && detail?.channelId) {
        setTransparencyTarget(detail)
      }
    }
    window.addEventListener("vortex:open-transparency", handler)
    return () => window.removeEventListener("vortex:open-transparency", handler)
  }, [])

  // Seed store with server-fetched channels once per server
  const seededServerRef = useRef<string | null>(null)
  useEffect(() => {
    if (seededServerRef.current !== server.id) {
      setChannels(server.id, initialChannels)
      seededServerRef.current = server.id
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, setChannels])

  const channels = storeChannels[server.id] ?? initialChannels
  const grouped = useMemo(() => groupChannels(channels), [channels])
  const categoryIds = useMemo(
    () => grouped.map((entry) => entry.category?.id).filter((id): id is string => !!id),
    [grouped]
  )
  const channelById = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels])

  useEffect(() => {
    const controller = new AbortController()

    async function loadThreadCounts() {
      try {
        const data = await fetchThreadCounts(server.id, controller.signal)
        if (!controller.signal.aborted && data) {
          setActiveThreadCounts(data)
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") console.error("Failed to load thread counts", error)
      }
    }

    // Skip the immediate fetch if SSR data was provided — the 30s poll will pick up changes
    if (!initialThreadCounts) {
      void loadThreadCounts()
    }
    const interval = window.setInterval(() => {
      void loadThreadCounts()
    }, 30000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [server.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync items when channels change (store update, realtime event, etc.).
  // Compare before overwriting to prevent no-op updates from realtime echoes
  // that confirm the same order we already have locally.
  useEffect(() => {
    const next = buildItems(grouped)
    if (isDraggingRef.current) {
      setItems((prev) => mergeItemsPreservingOrder(prev, next))
    } else {
      setItems((prev) => {
        const prevKeys = Object.keys(prev).sort()
        const nextKeys = Object.keys(next).sort()
        if (prevKeys.length !== nextKeys.length || prevKeys.some((k, i) => k !== nextKeys[i])) return next
        for (const key of prevKeys) {
          const a = prev[key]
          const b = next[key]
          if (!a || !b || a.length !== b.length || a.some((id, i) => id !== b[i])) return next
        }
        return prev
      })
    }
  }, [grouped])

  useEffect(() => {
    containerIndexRef.current = buildContainerIndex(items)
  }, [items])

  // Subscribe to realtime channel changes (INSERT / UPDATE / DELETE)
  const channelSidebarSubIdRef = useRef(0)
  useEffect(() => {
    const subId = ++channelSidebarSubIdRef.current
    const supabase = createClientSupabaseClient()
    const subscription = supabase
      .channel(`channels:${server.id}:${subId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "channels", filter: `server_id=eq.${server.id}` },
        (payload) => { addChannel(payload.new as ChannelRow) }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "channels", filter: `server_id=eq.${server.id}` },
        (payload) => { updateChannel((payload.new as ChannelRow).id, payload.new as ChannelRow) }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "channels", filter: `server_id=eq.${server.id}` },
        (payload) => { removeChannel((payload.old as { id: string }).id) }
      )
      .subscribe()
    return () => { supabase.removeChannel(subscription) }
  }, [server.id, addChannel, updateChannel, removeChannel])

  // Voice participants per channel
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>(initialVoiceParticipants ?? [])

  useEffect(() => {
    const supabase = createClientSupabaseClient()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    async function fetchVoiceParticipants() {
      const { data } = await supabase
        .from("voice_states")
        .select("user_id, channel_id, muted, deafened, users(id, username, display_name, avatar_url)")
        .eq("server_id", server.id)
      if (cancelled) return
      setVoiceParticipants(normalizeVoiceParticipants(data ?? []))
    }

    function debouncedFetch() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(fetchVoiceParticipants, 300)
    }

    // Skip initial fetch if SSR data was provided — real-time subscription handles updates
    if (!initialVoiceParticipants) {
      fetchVoiceParticipants()
    }

    const subscription = supabase
      .channel(`voice-states:${server.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voice_states", filter: `server_id=eq.${server.id}` },
        debouncedFetch
      )
      .subscribe()

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(subscription)
    }
  }, [server.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-group voice participants by channel to avoid per-item filtering
  const voiceParticipantsByChannel = useMemo(() => {
    const map = new Map<string, VoiceParticipant[]>()
    for (const p of voiceParticipants) {
      const list = map.get(p.channel_id)
      if (list) list.push(p)
      else map.set(p.channel_id, [p])
    }
    return map
  }, [voiceParticipants])

  // Compute effective permissions
  const userPermissions = useMemo(() => userRoles.reduce((acc, role) => acc | role.permissions, 0), [userRoles])
  const canManageChannels = isOwner || hasPermission(userPermissions, "MANAGE_CHANNELS")
  const canManageEvents = isOwner || hasPermission(userPermissions, "MANAGE_EVENTS")
  const canManageApps = isOwner || hasPermission(userPermissions, "MANAGE_WEBHOOKS") || hasPermission(userPermissions, "USE_APPLICATION_COMMANDS")

  // Track unread state for all message-bearing channels in this server
  const messageChannelIds = useMemo(
    () => channels.filter((c) => c.type !== "category" && c.type !== "voice").map((c) => c.id),
    [channels]
  )
  const { playNotification } = useNotificationSound()
  const unreadInitialData = initialUnreadChannelIds
    ? { unreadChannelIds: initialUnreadChannelIds, mentionCounts: initialMentionCounts ?? {} }
    : undefined
  const { unreadChannelIds, mentionCounts } = useUnreadChannels(
    server.id,
    messageChannelIds,
    currentUserId,
    activeChannelId,
    playNotification,
    unreadInitialData
  )

  // Keep the server-level unread indicator in the app store in sync so the
  // server sidebar can show a pip badge without needing its own subscription.
  //
  // Scope note: this effect only runs while ChannelSidebar is mounted (i.e.
  // while the user is looking at a specific server). Badges for other servers
  // are therefore only populated after the user visits them during a session.
  // A future BackgroundUnreadSync component could subscribe to all servers
  // up-front and call setServerHasUnread centrally, but that would multiply
  // Supabase realtime subscriptions. The current trade-off is intentional.
  useEffect(() => {
    setServerHasUnread(server.id, unreadChannelIds.size > 0)
  }, [server.id, unreadChannelIds, setServerHasUnread])

  useEffect(() => {
    setCategoryExpansionOverrides((prev) => {
      const allowed = new Set(categoryIds)
      const cleaned = Object.entries(prev).filter(([key]) => allowed.has(key))
      return cleaned.length === Object.keys(prev).length ? prev : Object.fromEntries(cleaned)
    })
  }, [categoryIds])

  const autoExpandedCategoryIds = useMemo(
    () => getAutoExpandedCategoryIds(channels, activeChannelId, unreadChannelIds, voiceChannelId),
    [channels, activeChannelId, unreadChannelIds, voiceChannelId]
  )

  const expandedCategoryIds = useMemo(
    () => resolveExpandedCategoryIds(categoryIds, autoExpandedCategoryIds, categoryExpansionOverrides),
    [categoryIds, autoExpandedCategoryIds, categoryExpansionOverrides]
  )

  const navigableChannelIds = useMemo(
    () => channels.filter((channel) => channel.type !== "category").sort((a, b) => a.position - b.position).map((channel) => channel.id),
    [channels]
  )

  const unreadNavigableChannelIds = useMemo(
    () => navigableChannelIds.filter((id) => unreadChannelIds.has(id)),
    [navigableChannelIds, unreadChannelIds]
  )

  const jumpToChannel = useCallback((channelId: string) => {
    if (!channelId) return
    router.push(`/channels/${server.id}/${channelId}`)
  }, [router, server.id])

  const jumpRelative = useCallback((ids: string[], direction: "next" | "prev") => {
    if (ids.length === 0) return
    const currentIndex = activeChannelId ? ids.indexOf(activeChannelId) : -1
    const nextIndex = direction === "next"
      ? (currentIndex >= ids.length - 1 ? 0 : currentIndex + 1)
      : (currentIndex <= 0 ? ids.length - 1 : currentIndex - 1)
    jumpToChannel(ids[nextIndex])
  }, [activeChannelId, jumpToChannel])

  // moveActiveChannel uses refs that are defined later (findContainer, persistChannelOrder)
  // so we use a stable ref to allow forward-referencing in the shortcut handlers.
  const moveActiveChannelRef = useRef<(direction: "up" | "down") => void>(() => {})

  const shortcutHandlers: ShortcutHandlers = useMemo(() => ({
    onQuickSwitcher: () => setQuickSwitcherOpen(true),
    onSearch: () => setSearchOpen(true),
    onSearchInChannel: () => setSearchOpen(true),
    onMarkRead: () => {
      if (activeChannelId) markChannelRead(activeChannelId)
    },
    onMarkAllServerRead: () => {
      const channelIdsToMark = navigableChannelIds.filter(
        (id) => unreadChannelIds.has(id) || (mentionCounts[id] ?? 0) > 0
      )
      if (channelIdsToMark.length === 0) return
      const supabase = createClientSupabaseClient()
      void (async () => {
        const BATCH_SIZE = 10
        for (let i = 0; i < channelIdsToMark.length; i += BATCH_SIZE) {
          const batch = channelIdsToMark.slice(i, i + BATCH_SIZE)
          await Promise.allSettled(
            batch.map((id) => markChannelReadRpc(supabase, id, "shortcut:markAllServerRead"))
          )
        }
      })()
    },
    onJumpChannelPrev: () => jumpRelative(navigableChannelIds, "prev"),
    onJumpChannelNext: () => jumpRelative(navigableChannelIds, "next"),
    onJumpUnreadPrev: () => jumpRelative(unreadNavigableChannelIds, "prev"),
    onJumpUnreadNext: () => jumpRelative(unreadNavigableChannelIds, "next"),
    ...(canManageChannels ? {
      onMoveChannelUp: () => moveActiveChannelRef.current("up"),
      onMoveChannelDown: () => moveActiveChannelRef.current("down"),
    } : {}),
    onToggleMemberList: () => toggleMemberList(),
    onToggleThreadPanel: () => toggleThreadPanel(),
    onToggleWorkspacePanel: () => toggleWorkspacePanel(),
    onOpenShortcutHelp: () => setShortcutHelpOpen(true),
    onAnalytics: (event) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[shortcuts] analytics", event)
      }
    },
  }), [activeChannelId, canManageChannels, jumpRelative, navigableChannelIds, unreadNavigableChannelIds, unreadChannelIds, mentionCounts, toggleMemberList, toggleThreadPanel, toggleWorkspacePanel])

  useKeyboardShortcuts(shortcutHandlers)

  function toggleCategory(id: string) {
    setCategoryExpansionOverrides((prev) => ({
      ...prev,
      [id]: !expandedCategoryIds.has(id),
    }))
  }

  async function confirmDeleteChannel() {
    if (!deleteTarget) return
    const { id: channelId } = deleteTarget
    setDeleteTarget(null)
    const supabase = createClientSupabaseClient()
    try {
      const { error } = await supabase.from("channels").delete().eq("id", channelId)
      if (error) throw error
      removeChannel(channelId)
      if (activeChannelId === channelId) {
        router.push(`/channels/${server.id}`)
      }
      toast({ title: "Channel deleted" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to delete channel", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  async function confirmDeleteCategory() {
    if (!deleteCategoryTarget) return
    const { id: categoryId } = deleteCategoryTarget
    setDeleteCategoryTarget(null)
    const supabase = createClientSupabaseClient()
    try {
      const { error } = await supabase.from("channels").delete().eq("id", categoryId)
      if (error) throw error
      removeChannel(categoryId)
      toast({ title: "Category deleted" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to delete category", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  function findContainer(channelId: string): string | null {
    return containerIndexRef.current[channelId] ?? null
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
    setOverContainerId(null)
    navigator.vibrate?.(15)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) { setOverContainerId(null); return }

    const draggedId = active.id as string
    if (getCategoryIdFromDragId(draggedId)) {
      // Category drag — track the over container for visual highlight but
      // don't do cross-container moves (categories live in a flat list).
      const overCatId = getCategoryIdFromDragId(over.id as string)
      setOverContainerId(overCatId)
      return
    }
    const overId = over.id as string
    // If hovering over a category sortable (id prefixed "category:"), resolve to the raw category id
    const resolvedOverId = getCategoryIdFromDragId(overId) ?? overId

    const targetContainer = itemsRef.current[resolvedOverId] !== undefined ? resolvedOverId : findContainer(resolvedOverId)
    setOverContainerId(targetContainer)

    const sourceContainer = findContainer(draggedId)
    if (!sourceContainer || !targetContainer || sourceContainer === targetContainer) return

    // Move optimistically between containers; update refs eagerly (before
    // setItems) so subsequent handlers read the correct state.
    const prev = itemsRef.current
    const sourceItems = [...(prev[sourceContainer] ?? [])]
    const targetItems = [...(prev[targetContainer] ?? [])]

    const sourceIndex = sourceItems.indexOf(draggedId)
    if (sourceIndex === -1) return
    sourceItems.splice(sourceIndex, 1)

    const overIndex = targetItems.indexOf(resolvedOverId)
    if (overIndex === -1) {
      targetItems.push(draggedId)
    } else {
      targetItems.splice(overIndex, 0, draggedId)
    }

    const next = { ...prev, [sourceContainer]: sourceItems, [targetContainer]: targetItems }
    itemsRef.current = next
    containerIndexRef.current = buildContainerIndex(next)
    setItems(next)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    setOverContainerId(null)
    navigator.vibrate?.(10)

    if (!over) return

    const draggedId = active.id as string
    const overId = over.id as string

    // Category reorder — resolve the drop target to a category ID even if the
    // pointer ended up over a channel or the category's inner droppable (raw UUID).
    const draggedCategoryId = getCategoryIdFromDragId(draggedId)
    if (draggedCategoryId) {
      let targetCategoryId = getCategoryIdFromDragId(overId)
      if (!targetCategoryId) {
        // Fell on a channel or raw category droppable — resolve to its container
        const container = findContainer(overId)
        if (container && container !== NO_CATEGORY) {
          targetCategoryId = container
        } else if (itemsRef.current[overId] !== undefined && overId !== NO_CATEGORY) {
          // overId is itself a container key (raw category UUID from the droppable)
          targetCategoryId = overId
        }
      }
      if (targetCategoryId && draggedCategoryId !== targetCategoryId) {
        persistCategoryOrder(draggedCategoryId, targetCategoryId)
      }
      return
    }

    // Channel reorder — resolve IDs and containers
    const latestItems = itemsRef.current
    const sourceContainer = findContainer(draggedId)
    const resolvedOverId = getCategoryIdFromDragId(overId) ?? overId
    const targetContainer = latestItems[resolvedOverId] !== undefined ? resolvedOverId : findContainer(resolvedOverId)

    if (!sourceContainer || !targetContainer) return

    if (sourceContainer === targetContainer) {
      const containerItems = [...(latestItems[sourceContainer] ?? [])]
      const oldIndex = containerItems.indexOf(draggedId)
      const newIndex = containerItems.indexOf(resolvedOverId)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(containerItems, oldIndex, newIndex)
        // Update refs BEFORE setItems — React 18 batching defers the updater
        // function to the render phase, so refs must be updated eagerly for
        // persistChannelOrder to read the correct order.
        const next = { ...latestItems, [sourceContainer]: reordered }
        itemsRef.current = next
        containerIndexRef.current = buildContainerIndex(next)
        setItems(next)
        persistChannelOrder()
      }
    } else {
      // Cross-container move was already applied in handleDragOver; persist
      persistChannelOrder()
    }
  }

  async function persistAllChannelStructure(categoryOrderOverride?: string[]) {
    const latestItems = itemsRef.current
    const categories = channels
      .filter((channel) => channel.type === "category")
      .sort((a, b) => a.position - b.position)
    const orderedCategoryIds = categoryOrderOverride ?? categories.map((category) => category.id)

    const orderedIds: string[] = [
      ...(latestItems[NO_CATEGORY] ?? []),
      ...orderedCategoryIds.flatMap((categoryId) => [categoryId, ...(latestItems[categoryId] ?? [])]),
    ]

    if (orderedIds.length === 0) return

    const channelById = new Map(channels.map((channel) => [channel.id, channel]))
    const updates = orderedIds
      .map((id, position) => {
        const channel = channelById.get(id)
        if (!channel) return null
        const parent_id = channel.type === "category"
          ? null
          : (findContainer(id) === NO_CATEGORY ? null : findContainer(id))
        return { id, position, parent_id }
      })
      .filter((update): update is { id: string; position: number; parent_id: string | null } => !!update)

    if (updates.length === 0) return

    const previous = updates.map(({ id }) => {
      const channel = channelById.get(id)
      return {
        id,
        position: channel?.position ?? 0,
        parent_id: channel?.parent_id ?? null,
      }
    })

    // Apply all position changes in a single store update to avoid batching issues
    const updateMap = new Map(updates.map(({ id, position, parent_id }) => [id, { position, parent_id }]))
    const updatedChannels = channels.map((c) => {
      const upd = updateMap.get(c.id)
      return upd ? { ...c, ...upd } : c
    })
    setChannels(server.id, updatedChannels)

    const supabase = createClientSupabaseClient()
    try {
      const { error } = await supabase.rpc("reorder_channels", {
        p_server_id: server.id,
        p_updates: updates.map(({ id, position, parent_id }) => ({ id, position, parent_id })),
      })
      if (error) throw error
    } catch (error: unknown) {
      // Rollback: restore previous positions in a single store update
      const rollbackMap = new Map(previous.map(({ id, position, parent_id }) => [id, { position, parent_id }]))
      const rolledBack = channels.map((c) => {
        const rb = rollbackMap.get(c.id)
        return rb ? { ...c, ...rb } : c
      })
      setChannels(server.id, rolledBack)
      toast({ variant: "destructive", title: "Failed to save channel order", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  async function persistCategoryOrder(draggedCategoryId: string, overCategoryId: string) {
    const categories = channels
      .filter((channel) => channel.type === "category")
      .sort((a, b) => a.position - b.position)
    const oldIndex = categories.findIndex((category) => category.id === draggedCategoryId)
    const newIndex = categories.findIndex((category) => category.id === overCategoryId)
    if (oldIndex === -1 || newIndex === -1) return

    const reorderedCategoryIds = arrayMove(categories, oldIndex, newIndex).map((category) => category.id)
    await persistAllChannelStructure(reorderedCategoryIds)
  }

  async function persistChannelOrder() {
    await persistAllChannelStructure()
  }

  // Keyboard alternative for drag-and-drop channel reordering (Ctrl/Cmd+Alt+Arrow)
  // Keep the ref in sync so the single useKeyboardShortcuts call above works.
  moveActiveChannelRef.current = (direction: "up" | "down") => {
    if (!canManageChannels || !activeChannelId) return
    const containerId = findContainer(activeChannelId)
    if (!containerId) return
    const containerItems = [...(itemsRef.current[containerId] ?? [])]
    const idx = containerItems.indexOf(activeChannelId)
    if (idx === -1) return
    const targetIdx = direction === "up" ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= containerItems.length) return
    const reordered = arrayMove(containerItems, idx, targetIdx)
    const next = { ...itemsRef.current, [containerId]: reordered }
    itemsRef.current = next
    containerIndexRef.current = buildContainerIndex(next)
    setItems(next)
    persistChannelOrder()
  }

  const activeChannel = activeId ? channels.find((c) => c.id === activeId) : null
  const activeCategoryId = activeId ? getCategoryIdFromDragId(activeId) : null
  const activeCategory = activeCategoryId ? channels.find((c) => c.id === activeCategoryId) : null

  // Rebuild grouped view from live items map to reflect drag state
  const liveGrouped = useMemo(
    () => grouped.map(({ category }) => {
      const key = category?.id ?? NO_CATEGORY
      const channelIds = items[key] ?? []
      const categoryChannels = channelIds
        .map((id) => channelById.get(id))
        .filter((c): c is ChannelRow => !!c)
      return { category, channels: categoryChannels }
    }),
    [grouped, items, channelById]
  )

  // Channels eligible for webhooks are all message-based channel types
  const webhookEligibleChannels = useMemo(
    () => channels
      .filter((c) => (MESSAGE_CHANNEL_TYPES as readonly string[]).includes(c.type))
      .map((c) => ({ id: c.id, name: c.name })),
    [channels]
  )

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Channels"
        className="w-full md:w-60 h-full flex flex-col flex-shrink-0 channel-sidebar-surface"
      >
        {/* Server header */}
        <button
          onClick={() => setShowServerSettings(true)}
          className="flex items-center justify-between px-4 py-3 border-b cursor-pointer surface-hover motion-interactive motion-press group focus-ring channel-sidebar-header" aria-label="Open server settings"
        >
          <span className="font-semibold truncate text-sm channel-sidebar-title">{server.name}</span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 motion-interactive text-muted-interactive" />
        </button>

        {canManageEvents && (
          <button
            onClick={() => router.push(`/channels/${server.id}/events`)}
            className="mx-2 mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm surface-hover-md motion-interactive motion-press focus-ring channel-sidebar-events" aria-label="Open server events"
          >
            <CalendarDays className="h-4 w-4" />
            Events
          </button>
        )}

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto py-2">
          {canManageChannels ? (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={grouped.filter((g) => g.category).map((g) => getCategoryDragId(g.category!.id))}
              strategy={verticalListSortingStrategy}
            >
            {liveGrouped.map(({ category, channels: categoryChannels }) => {
              const containerId = category?.id ?? NO_CATEGORY
              const isCollapsed = category ? !expandedCategoryIds.has(category.id) : false

              return (
                <div key={containerId} className="mb-2">
                  {category && (
                    <CategoryHeader
                      category={category}
                      containerId={containerId}
                      isCollapsed={isCollapsed}
                      canManageChannels={canManageChannels}
                      isDragOver={overContainerId === containerId && !!activeId}
                      onToggle={() => toggleCategory(category.id)}
                      onAddChannel={() => {
                        setCreateChannelCategoryId(category.id)
                        setShowCreateChannel(true)
                      }}
                      onEdit={() => setEditCategoryTarget(category)}
                      onDelete={() => setDeleteCategoryTarget({ id: category.id, name: category.name })}
                      onCopyId={() => {
                        void navigator.clipboard.writeText(category.id)
                          .then(() => { toast({ title: "Category ID copied!" }) })
                          .catch(() => { toast({ variant: "destructive", title: "Failed to copy category ID" }) })
                      }}
                    />
                  )}

                  {!category && <DropContainer id={containerId} />}

                  <SortableContext
                    id={containerId}
                    items={items[containerId] ?? []}
                    strategy={verticalListSortingStrategy}
                  >
                    <div
                      className={cn(
                        "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                        isCollapsed ? "grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none" : "grid-rows-[1fr] opacity-100 translate-y-0"
                      )}
                      aria-hidden={isCollapsed || undefined}
                      ref={(node) => {
                        if (node) {
                          if (isCollapsed) node.setAttribute("inert", "")
                          else node.removeAttribute("inert")
                        }
                      }}
                    >
                    <div className="space-y-0.5 px-2 min-h-[4px] overflow-hidden">
                        {categoryChannels.map((channel) => (
                          <SortableChannelItem
                            key={channel.id}
                            channel={channel}
                            isActive={activeChannelId === channel.id}
                            isVoiceActive={voiceChannelId === channel.id}
                            onOpenNotificationSettings={setNotifSettingsChannelId}
                            onMarkRead={() => markChannelRead(channel.id)}
                            canManageChannels={canManageChannels}
                            isDragging={activeId === channel.id}
                            isUnread={unreadChannelIds.has(channel.id)}
                            mentionCount={mentionCounts[channel.id] ?? 0}
                            activeThreadCount={activeThreadCounts[channel.id] ?? 0}
                            voiceParticipants={
                              (VOICE_CHANNEL_TYPES as readonly string[]).includes(channel.type)
                                ? voiceParticipantsByChannel.get(channel.id)
                                : undefined
                            }
                            href={`/channels/${server.id}/${channel.id}`}
                            onClick={() => {
                              if (channel.parent_id) {
                                setCategoryExpansionOverrides((prev) => ({ ...prev, [channel.parent_id!]: true }))
                              }
                              if ((VOICE_CHANNEL_TYPES as readonly string[]).includes(channel.type)) {
                                setVoiceChannel(channel.id, server.id, channel.name)
                              }
                              router.push(`/channels/${server.id}/${channel.id}`)
                            }}
                            onEdit={() => setEditTarget(channel)}
                            onDelete={() => setDeleteTarget({ id: channel.id, name: channel.name })}
                            onCreateThread={() => {
                              router.push(`/channels/${server.id}/${channel.id}?createThread=1`)
                            }}
                          />
                        ))}

                        {/* Drop hint for empty categories */}
                        {categoryChannels.length === 0 && activeId && (
                          <div className="h-8 rounded flex items-center justify-center" style={{ border: '1px dashed color-mix(in srgb, var(--theme-text-primary) 20%, transparent)' }}>
                            <span className="text-xs tertiary-metadata">Drop here</span>
                          </div>
                        )}
                    </div>
                    </div>
                  </SortableContext>
                </div>
              )
            })}
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeChannel ? (
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm shadow-lg opacity-90 channel-sidebar-drag-overlay"
                  style={{ width: '208px' }}
                >
                  <ChannelIcon channel={activeChannel} isVoiceActive={false} />
                  <span className="truncate">{activeChannel.name}</span>
                </div>
              ) : activeCategory ? (
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm shadow-lg opacity-90 channel-sidebar-drag-overlay"
                  style={{ width: '208px' }}
                >
                  <ChevronDown className="w-3 h-3 tertiary-metadata" />
                  <span className="truncate uppercase text-xs font-semibold tracking-wider">{activeCategory.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          ) : (
            /* Non-admin: static components without dnd-kit hooks */
            <>
            {liveGrouped.map(({ category, channels: categoryChannels }) => {
              const containerId = category?.id ?? NO_CATEGORY
              const isCollapsed = category ? !expandedCategoryIds.has(category.id) : false
              return (
                <div key={containerId} className="mb-2">
                  {category && (
                    <StaticCategoryHeader
                      category={category}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleCategory(category.id)}
                      onCopyId={() => {
                        void navigator.clipboard.writeText(category.id)
                          .then(() => { toast({ title: "Category ID copied!" }) })
                          .catch(() => { toast({ variant: "destructive", title: "Failed to copy category ID" }) })
                      }}
                    />
                  )}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                      isCollapsed ? "grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none" : "grid-rows-[1fr] opacity-100 translate-y-0"
                    )}
                    aria-hidden={isCollapsed || undefined}
                    ref={(node) => {
                      if (node) {
                        if (isCollapsed) node.setAttribute("inert", "")
                        else node.removeAttribute("inert")
                      }
                    }}
                  >
                  <div className="space-y-0.5 px-2 min-h-[4px] overflow-hidden">
                    {categoryChannels.map((channel) => (
                      <StaticChannelItem
                        key={channel.id}
                        channel={channel}
                        isActive={activeChannelId === channel.id}
                        isVoiceActive={voiceChannelId === channel.id}
                        onOpenNotificationSettings={setNotifSettingsChannelId}
                        onMarkRead={() => markChannelRead(channel.id)}
                        isUnread={unreadChannelIds.has(channel.id)}
                        mentionCount={mentionCounts[channel.id] ?? 0}
                        activeThreadCount={activeThreadCounts[channel.id] ?? 0}
                        voiceParticipants={
                          (VOICE_CHANNEL_TYPES as readonly string[]).includes(channel.type)
                            ? voiceParticipantsByChannel.get(channel.id)
                            : undefined
                        }
                        href={`/channels/${server.id}/${channel.id}`}
                        onClick={() => {
                          if (channel.parent_id) {
                            setCategoryExpansionOverrides((prev) => ({ ...prev, [channel.parent_id!]: true }))
                          }
                          if ((VOICE_CHANNEL_TYPES as readonly string[]).includes(channel.type)) {
                            setVoiceChannel(channel.id, server.id, channel.name)
                          }
                          router.push(`/channels/${server.id}/${channel.id}`)
                        }}
                        onCreateThread={() => {
                          router.push(`/channels/${server.id}/${channel.id}?createThread=1`)
                        }}
                      />
                    ))}
                  </div>
                  </div>
                </div>
              )
            })}
            </>
          )}

          {/* Add channel button */}
          {canManageChannels && (
            <div className="px-2 mt-1">
              <button
                onClick={() => {
                  setCreateChannelCategoryId(undefined)
                  setShowCreateChannel(true)
                }}
                className="flex items-center gap-1 px-2 py-1 rounded w-full surface-hover motion-interactive motion-press focus-ring tertiary-metadata" aria-label="Add channel"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">Add Channel</span>
              </button>
            </div>
          )}
        </div>

        {/* Compact voice bar — appears above user panel when in a voice channel */}
        <CompactVoiceBar />

        {/* User panel */}
        <UserPanel />

        {/* Modals */}
        <CreateChannelModal
          open={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
          serverId={server.id}
          categoryId={createChannelCategoryId}
        />
        <ServerSettingsModal
          open={showServerSettings}
          onClose={() => setShowServerSettings(false)}
          server={server}
          isOwner={isOwner}
          canManageApps={canManageApps}
          channels={webhookEligibleChannels}
        />

        {quickSwitcherOpen && <QuickSwitcherModal onClose={() => setQuickSwitcherOpen(false)} />}
        {searchOpen && (
          <SearchModal
            serverId={server.id}
            onClose={() => setSearchOpen(false)}
            onJumpToMessage={(channelId, messageId) => {
              router.push(`/channels/${server.id}/${channelId}?message=${encodeURIComponent(messageId)}`)
            }}
          />
        )}
        <KeyboardShortcutsModal
          open={shortcutHelpOpen}
          onOpenChange={setShortcutHelpOpen}
          handlers={shortcutHandlers}
        />
        {editTarget && (
          <EditChannelModal
            open={!!editTarget}
            onClose={() => setEditTarget(null)}
            channel={editTarget}
          />
        )}

        {/* Single hoisted notification settings modal for all channels */}
        <NotificationSettingsModal
          open={!!notifSettingsChannelId}
          onClose={() => setNotifSettingsChannelId(null)}
          channelId={notifSettingsChannelId ?? undefined}
          label={notifSettingsChannelId ? `#${channelById.get(notifSettingsChannelId)?.name ?? "channel"}` : ""}
        />

        {/* Delete channel confirmation dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <DialogContent className="channel-sidebar-dialog-content">
            <DialogHeader>
              <DialogTitle className="channel-sidebar-title">Delete Channel</DialogTitle>
              <DialogDescription className="channel-sidebar-description">
                Are you sure you want to delete{" "}
                <span className="font-semibold channel-sidebar-title">#{deleteTarget?.name}</span>?
                {" "}This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded text-sm font-medium motion-interactive motion-press surface-hover-md focus-ring channel-sidebar-description"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteChannel}
                className="px-4 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-500 text-white motion-interactive motion-press focus-ring"
              >
                Delete Channel
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete category confirmation */}
        <Dialog open={!!deleteCategoryTarget} onOpenChange={(open) => { if (!open) setDeleteCategoryTarget(null) }}>
          <DialogContent className="channel-sidebar-dialog-content">
            <DialogHeader>
              <DialogTitle className="channel-sidebar-title">Delete Category</DialogTitle>
              <DialogDescription className="channel-sidebar-description">
                Are you sure you want to delete{" "}
                <span className="font-semibold channel-sidebar-title">{deleteCategoryTarget?.name}</span>?
                {" "}Channels inside will be moved to uncategorized. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                onClick={() => setDeleteCategoryTarget(null)}
                className="px-4 py-2 rounded text-sm font-medium motion-interactive motion-press surface-hover-md focus-ring channel-sidebar-description"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteCategory}
                className="px-4 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-500 text-white motion-interactive motion-press focus-ring"
              >
                Delete Category
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit category (reuse EditChannelModal) */}
        {editCategoryTarget && (
          <EditChannelModal
            channel={editCategoryTarget}
            open={!!editCategoryTarget}
            onClose={() => setEditCategoryTarget(null)}
          />
        )}

        {/* Transparency report dialog */}
        <Dialog open={!!transparencyTarget} onOpenChange={(open) => { if (!open) setTransparencyTarget(null) }}>
          <DialogContent className="channel-sidebar-dialog-content p-0 max-w-sm">
            <DialogHeader className="sr-only">
              <DialogTitle>Channel Transparency Report</DialogTitle>
              <DialogDescription>View channel visibility and recent moderation actions</DialogDescription>
            </DialogHeader>
            {transparencyTarget && (
              <TransparencyPanel
                serverId={transparencyTarget.serverId}
                channelId={transparencyTarget.channelId}
                inline
              />
            )}
          </DialogContent>
        </Dialog>
      </nav>
    </TooltipProvider>
  )
}

