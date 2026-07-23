import { create } from "zustand"
import type { UserRow, MessageWithAuthor } from "@/types/database"
import { loadBooleanStorage, persistBooleanStorage } from "@/lib/utils/storage"
import type { MobileAction } from "@vortex/shared"

export type { MobileAction }

const MEMBER_LIST_STORAGE_KEY = "vortexchat:ui:member-list-open"
const THREAD_PANEL_STORAGE_KEY = "vortexchat:ui:thread-panel-open"
const WORKSPACE_PANEL_STORAGE_KEY = "vortexchat:ui:workspace-panel-open"

export interface MemberForMention {
  user_id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  nickname: string | null
}

export interface RoleForMention {
  id: string
  name: string
  color: string
  mentionable: boolean
}

export interface PersonaForMention {
  id: string
  name: string
  avatar_url: string | null
  description: string | null
}

interface AppState {
  // Current user
  currentUser: UserRow | null
  setCurrentUser: (user: UserRow | null) => void

  // Active state
  activeChannelId: string | null
  setActiveChannel: (channelId: string | null) => void

  // UI state
  memberListOpen: boolean
  toggleMemberList: () => void
  setMemberListOpen: (open: boolean) => void
  threadPanelOpen: boolean
  toggleThreadPanel: () => void
  setThreadPanelOpen: (open: boolean) => void
  workspaceOpen: boolean
  toggleWorkspacePanel: () => void
  setWorkspaceOpen: (open: boolean) => void

  // Modal / panel visibility (extracted from ChatArea to avoid re-rendering the message list)
  showSearchModal: boolean
  setShowSearchModal: (open: boolean) => void
  showKeyboardShortcuts: boolean
  setShowKeyboardShortcuts: (open: boolean) => void
  showCreateChannelThread: boolean
  setShowCreateChannelThread: (open: boolean) => void
  showSummary: boolean
  toggleShowSummary: () => void
  setShowSummary: (open: boolean) => void
  showPinnedPanel: boolean
  toggleShowPinnedPanel: () => void
  setShowPinnedPanel: (open: boolean) => void
  overflowOpen: boolean
  toggleOverflowOpen: () => void
  setOverflowOpen: (open: boolean) => void

  // Notification + DM unread counts (shared between NotificationBell, DMList, and useTabUnreadTitle)
  notificationUnreadCount: number
  setNotificationUnreadCount: (count: number) => void
  // Mention-type notification count (drives numeric favicon badge vs dot)
  notificationMentionCount: number
  setNotificationMentionCount: (count: number) => void
  dmUnreadCount: number
  setDmUnreadCount: (count: number) => void

  // Notification mute state (synced from notification_settings table)
  // Maps entity ID -> mode for quick lookup
  notificationModes: Record<string, "all" | "mentions" | "muted">
  notificationModesLoaded: boolean
  setNotificationMode: (entityId: string, mode: "all" | "mentions" | "muted") => void
  removeNotificationMode: (entityId: string) => void
  loadNotificationSettings: () => Promise<void>

  // Message cache (per-channel, most recent messages for instant channel switching)
  messageCache: Record<string, { messages: MessageWithAuthor[]; scrollOffset: number; timestamp: number }>
  cacheMessages: (channelId: string, messages: MessageWithAuthor[], scrollOffset?: number) => void
  invalidateMessageCache: (channelId: string) => void

  // Mobile action dispatch (replaces fragile DOM CustomEvents between ServerMobileLayout → ChatArea)
  mobilePendingAction: MobileAction | null
  setMobilePendingAction: (action: MobileAction | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  activeChannelId: null,
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  memberListOpen: loadBooleanStorage(MEMBER_LIST_STORAGE_KEY, true),
  toggleMemberList: () => set((state) => {
    const next = !state.memberListOpen
    persistBooleanStorage(MEMBER_LIST_STORAGE_KEY, next)
    return { memberListOpen: next }
  }),
  setMemberListOpen: (open) => {
    persistBooleanStorage(MEMBER_LIST_STORAGE_KEY, open)
    set({ memberListOpen: open })
  },
  threadPanelOpen: loadBooleanStorage(THREAD_PANEL_STORAGE_KEY, true),
  toggleThreadPanel: () => set((state) => {
    const next = !state.threadPanelOpen
    persistBooleanStorage(THREAD_PANEL_STORAGE_KEY, next)
    return { threadPanelOpen: next }
  }),
  setThreadPanelOpen: (open) => set(() => {
    persistBooleanStorage(THREAD_PANEL_STORAGE_KEY, open)
    return { threadPanelOpen: open }
  }),
  workspaceOpen: loadBooleanStorage(WORKSPACE_PANEL_STORAGE_KEY, false),
  toggleWorkspacePanel: () => set((state) => {
    const next = !state.workspaceOpen
    persistBooleanStorage(WORKSPACE_PANEL_STORAGE_KEY, next)
    return { workspaceOpen: next }
  }),
  setWorkspaceOpen: (open) => set(() => {
    persistBooleanStorage(WORKSPACE_PANEL_STORAGE_KEY, open)
    return { workspaceOpen: open }
  }),

  // Modal / panel visibility
  showSearchModal: false,
  setShowSearchModal: (open) => set({ showSearchModal: open }),
  showKeyboardShortcuts: false,
  setShowKeyboardShortcuts: (open) => set({ showKeyboardShortcuts: open }),
  showCreateChannelThread: false,
  setShowCreateChannelThread: (open) => set({ showCreateChannelThread: open }),
  showSummary: false,
  toggleShowSummary: () => set((state) => ({ showSummary: !state.showSummary })),
  setShowSummary: (open) => set({ showSummary: open }),
  showPinnedPanel: false,
  toggleShowPinnedPanel: () => set((state) => ({ showPinnedPanel: !state.showPinnedPanel })),
  setShowPinnedPanel: (open) => set({ showPinnedPanel: open }),
  overflowOpen: false,
  toggleOverflowOpen: () => set((state) => ({ overflowOpen: !state.overflowOpen })),
  setOverflowOpen: (open) => set({ overflowOpen: open }),

  notificationUnreadCount: 0,
  setNotificationUnreadCount: (count) => set({ notificationUnreadCount: count }),
  notificationMentionCount: 0,
  setNotificationMentionCount: (count) => set({ notificationMentionCount: count }),
  dmUnreadCount: 0,
  setDmUnreadCount: (count) => set({ dmUnreadCount: count }),

  notificationModes: {},
  notificationModesLoaded: false,
  setNotificationMode: (entityId, mode) =>
    set((state) => ({
      notificationModes: { ...state.notificationModes, [entityId]: mode },
    })),
  removeNotificationMode: (entityId) =>
    set((state) => {
      const next = { ...state.notificationModes }
      delete next[entityId]
      return { notificationModes: next }
    }),
  loadNotificationSettings: async () => {
    try {
      const res = await fetch("/api/notification-settings")
      if (!res.ok) { set({ notificationModesLoaded: true }); return }
      const rows = await res.json()
      if (!Array.isArray(rows)) { set({ notificationModesLoaded: true }); return }
      const modes: Record<string, "all" | "mentions" | "muted"> = {}
      for (const row of rows) {
        const id = row.server_id || row.channel_id || row.thread_id
        if (id && row.mode) modes[id] = row.mode
      }
      set({ notificationModes: modes, notificationModesLoaded: true })
    } catch {
      set({ notificationModesLoaded: true })
    }
  },

  messageCache: {},
  cacheMessages: (channelId, messages, scrollOffset = 0) =>
    set((state) => {
      const cache = { ...state.messageCache }
      // Keep only last 100 messages per channel and cap at 10 cached channels
      cache[channelId] = {
        messages: messages.slice(-100),
        scrollOffset,
        timestamp: Date.now(),
      }
      // Evict oldest if over 10 channels cached
      const keys = Object.keys(cache)
      if (keys.length > 10) {
        let oldestKey = keys[0]
        for (const k of keys) {
          if (cache[k].timestamp < cache[oldestKey].timestamp) oldestKey = k
        }
        delete cache[oldestKey]
      }
      return { messageCache: cache }
    }),
  invalidateMessageCache: (channelId) =>
    set((state) => {
      const cache = { ...state.messageCache }
      delete cache[channelId]
      return { messageCache: cache }
    }),

  mobilePendingAction: null,
  setMobilePendingAction: (action) => set({ mobilePendingAction: action }),
}))
