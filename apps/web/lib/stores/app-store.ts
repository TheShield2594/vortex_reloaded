import { create } from "zustand"
import type { UserRow } from "@/types/database"

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
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  activeChannelId: null,
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

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
}))
