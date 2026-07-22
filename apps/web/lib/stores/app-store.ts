import { create } from "zustand"
import type { ServerRow, ChannelRow, UserRow, MessageWithAuthor } from "@/types/database"
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

  // Servers
  servers: ServerRow[]
  isLoadingServers: boolean
  setIsLoadingServers: (isLoading: boolean) => void
  setServers: (servers: ServerRow[]) => void
  addServer: (server: ServerRow) => void
  updateServer: (id: string, updates: Partial<ServerRow>) => void
  removeServer: (id: string) => void

  // Channels
  channels: Record<string, ChannelRow[]> // serverId -> channels
  setChannels: (serverId: string, channels: ChannelRow[]) => void
  addChannel: (channel: ChannelRow) => void
  updateChannel: (id: string, updates: Partial<ChannelRow>) => void
  removeChannel: (id: string) => void

  // Members (for mention autocomplete)
  members: Record<string, MemberForMention[]> // serverId -> members
  setMembers: (serverId: string, members: MemberForMention[]) => void

  // Roles (for @role mention autocomplete + rendering)
  serverRoles: Record<string, RoleForMention[]> // serverId -> roles
  setServerRoles: (serverId: string, roles: RoleForMention[]) => void

  // AI Personas (for @persona mention autocomplete)
  personas: Record<string, PersonaForMention[]> // serverId -> personas
  setPersonas: (serverId: string, personas: PersonaForMention[]) => void

  // Active state
  activeServerId: string | null
  activeChannelId: string | null
  setActiveServer: (serverId: string | null) => void
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

  // Per-server unread indicator (true = at least one unread channel in this server)
  serverHasUnread: Record<string, boolean>
  setServerHasUnread: (serverId: string, hasUnread: boolean) => void

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

  // Voice state
  voiceChannelId: string | null
  voiceServerId: string | null
  voiceChannelName: string | null
  setVoiceChannel: (channelId: string | null, serverId: string | null, channelName?: string | null) => void
  voiceMuted: boolean
  voiceDeafened: boolean
  voiceReconnectInfo: { state: string; attempt: number; maxAttempts: number } | null
  voiceJoinedAt: number | null
  voiceToggleMute: (() => void) | null
  voiceToggleDeafen: (() => void) | null
  voiceManualReconnect: (() => void) | null
  setVoiceControls: (controls: {
    muted: boolean
    deafened: boolean
    reconnectInfo?: { state: string; attempt: number; maxAttempts: number } | null
    toggleMute?: () => void
    toggleDeafen?: () => void
    manualReconnect?: () => void
  }) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  servers: [],
  isLoadingServers: true,
  setIsLoadingServers: (isLoadingServers) => set({ isLoadingServers }),
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((state) => ({ servers: [...state.servers, server] })),
  updateServer: (id, updates) =>
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),
  removeServer: (id) =>
    set((state) => ({ servers: state.servers.filter((s) => s.id !== id) })),

  channels: {},
  setChannels: (serverId, channels) =>
    set((state) => ({ channels: { ...state.channels, [serverId]: channels } })),
  addChannel: (channel) =>
    set((state) => {
      const existing = state.channels[channel.server_id] || []
      if (existing.some((c) => c.id === channel.id)) return state
      return {
        channels: {
          ...state.channels,
          [channel.server_id]: [...existing, channel],
        },
      }
    }),
  updateChannel: (id, updates) =>
    set((state) => {
      const newChannels = { ...state.channels }
      for (const serverId in newChannels) {
        newChannels[serverId] = newChannels[serverId].map((c) =>
          c.id === id ? { ...c, ...updates } : c
        )
      }
      return { channels: newChannels }
    }),
  removeChannel: (id) =>
    set((state) => {
      const newChannels = { ...state.channels }
      for (const serverId in newChannels) {
        newChannels[serverId] = newChannels[serverId].filter((c) => c.id !== id)
      }
      return { channels: newChannels }
    }),

  members: {},
  setMembers: (serverId, members) =>
    set((state) => ({ members: { ...state.members, [serverId]: members } })),

  serverRoles: {},
  setServerRoles: (serverId, roles) =>
    set((state) => ({ serverRoles: { ...state.serverRoles, [serverId]: roles } })),

  personas: {},
  setPersonas: (serverId, personas) =>
    set((state) => ({ personas: { ...state.personas, [serverId]: personas } })),

  activeServerId: null,
  activeChannelId: null,
  setActiveServer: (serverId) => set({ activeServerId: serverId }),
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

  serverHasUnread: {},
  setServerHasUnread: (serverId, hasUnread) =>
    set((state) => {
      if (state.serverHasUnread[serverId] === hasUnread) return state
      return { serverHasUnread: { ...state.serverHasUnread, [serverId]: hasUnread } }
    }),

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

  voiceChannelId: null,
  voiceServerId: null,
  voiceChannelName: null,
  setVoiceChannel: (channelId, serverId, channelName = null) =>
    set({
      voiceChannelId: channelId,
      voiceServerId: serverId,
      voiceChannelName: channelId ? channelName : null,
      voiceJoinedAt: channelId ? Date.now() : null,
      // Clear controls when disconnecting
      ...(channelId ? {} : {
        voiceMuted: false,
        voiceDeafened: false,
        voiceReconnectInfo: null,
        voiceToggleMute: null,
        voiceToggleDeafen: null,
        voiceManualReconnect: null,
      }),
    }),
  voiceMuted: false,
  voiceDeafened: false,
  voiceReconnectInfo: null,
  voiceJoinedAt: null,
  voiceToggleMute: null,
  voiceToggleDeafen: null,
  voiceManualReconnect: null,
  setVoiceControls: (controls) =>
    set({
      voiceMuted: controls.muted,
      voiceDeafened: controls.deafened,
      ...(controls.reconnectInfo !== undefined ? { voiceReconnectInfo: controls.reconnectInfo ?? null } : {}),
      ...(controls.toggleMute ? { voiceToggleMute: controls.toggleMute } : {}),
      ...(controls.toggleDeafen ? { voiceToggleDeafen: controls.toggleDeafen } : {}),
      ...(controls.manualReconnect ? { voiceManualReconnect: controls.manualReconnect } : {}),
    }),
}))
