"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, CheckCheck, Hash, AtSign, UserPlus, X } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { useNotificationPreferences } from "@/hooks/use-notification-preferences"
import { shouldNotify, showBrowserNotification } from "@/lib/notification-manager"
import { format } from "date-fns"
import { Skeleton } from "@/components/ui/skeleton"

interface Notification {
  id: string
  type: "mention" | "reply" | "friend_request" | "server_invite" | "system"
  title: string
  body: string | null
  icon_url: string | null
  server_id: string | null
  channel_id: string | null
  message_id: string | null
  read: boolean
  created_at: string
}

const TYPE_ICONS: Record<Notification["type"], React.ReactNode> = {
  mention: <AtSign className="w-4 h-4" />,
  reply: <Hash className="w-4 h-4" />,
  friend_request: <UserPlus className="w-4 h-4" />,
  server_invite: <Hash className="w-4 h-4" />,
  system: <Bell className="w-4 h-4" />,
}

type Filter = "all" | "unread" | "mentions"

/** Merge fetched rows into existing state, deduplicating by id */
function mergeNotifications(existing: Notification[], incoming: Notification[]): Notification[] {
  const map = new Map<string, Notification>()
  for (const n of existing) map.set(n.id, n)
  for (const n of incoming) map.set(n.id, n)
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export default function NotificationsPage() {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const router = useRouter()
  const { playNotification } = useNotificationSound()
  const currentUser = useAppStore((s) => s.currentUser)
  const { prefs } = useNotificationPreferences(currentUser?.id ?? null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>("all")
  const subIdRef = useRef(0)

  // Local unread count for UI within this page (may be truncated to 50 rows)
  const localUnreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])

  // True unread count for the global badge — fetched separately to avoid limit(50) undercount
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const refreshTotalUnread = useCallback(async (): Promise<void> => {
    if (!currentUser) return
    try {
      const res = await fetch("/api/notifications?countOnly=true")
      if (!res.ok) return
      const { unreadCount } = await res.json() as { unreadCount: number }
      setTotalUnreadCount(unreadCount)
      useAppStore.getState().setNotificationUnreadCount(unreadCount)
    } catch {
      // ignore — next poll will retry
    }
  }, [currentUser])

  const loadNotifications = useCallback(async (): Promise<void> => {
    if (!currentUser) return
    try {
      const res = await fetch("/api/notifications?limit=50")
      if (!res.ok) throw new Error("Failed to fetch")
      const { notifications: data } = await res.json() as { notifications: Notification[] }
      setNotifications((prev) => mergeNotifications(prev, data))
    } catch {
      // ignore — keep existing state
    }
    await refreshTotalUnread()
    setLoading(false)
  }, [currentUser, refreshTotalUnread])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  // Real-time subscription
  useEffect(() => {
    if (!currentUser) return
    const subId = ++subIdRef.current
    const ch = supabase
      .channel(`notifications-page:${currentUser.id}:${subId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUser.id}` },
        (payload) => {
          const n = payload.new as Notification
          setNotifications((prev) => mergeNotifications(prev, [n]).slice(0, 50))
          if (!n.read) {
            setTotalUnreadCount((prev) => prev + 1)
            useAppStore.getState().setNotificationUnreadCount(
              (useAppStore.getState().notificationUnreadCount ?? 0) + 1
            )
          }
          const { shouldPlaySound, shouldShowBrowserNotification } = shouldNotify({
            channelId: n.channel_id,
            messageId: n.message_id,
          })
          if (shouldPlaySound && prefs.sound_enabled) {
            const soundType = n.type === "mention" ? "mention" as const : "message" as const
            playNotification(soundType)
          }
          if (shouldShowBrowserNotification && n.title) {
            const url = n.server_id && n.channel_id
              ? `/channels/${n.server_id}/${n.channel_id}`
              : undefined
            showBrowserNotification({
              title: n.title,
              body: n.body || "",
              channelId: n.channel_id || undefined,
              url,
            })
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [currentUser, supabase, playNotification, prefs.sound_enabled])

  async function markAllRead(): Promise<void> {
    if (!currentUser) return
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) return
    } catch {
      return
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setTotalUnreadCount(0)
    useAppStore.getState().setNotificationUnreadCount(0)
  }

  async function markRead(id: string): Promise<void> {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) return
    } catch {
      return
    }
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setTotalUnreadCount((prev) => Math.max(0, prev - 1))
    useAppStore.getState().setNotificationUnreadCount(
      Math.max(0, (useAppStore.getState().notificationUnreadCount ?? 0) - 1)
    )
  }

  async function dismiss(id: string): Promise<void> {
    const target = notifications.find((x) => x.id === id)
    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) return
    } catch {
      return
    }
    setNotifications((prev) => prev.filter((x) => x.id !== id))
    if (target && !target.read) {
      setTotalUnreadCount((prev) => Math.max(0, prev - 1))
      useAppStore.getState().setNotificationUnreadCount(
        Math.max(0, (useAppStore.getState().notificationUnreadCount ?? 0) - 1)
      )
    }
  }

  async function handleClick(n: Notification): Promise<void> {
    try {
      if (!n.read) await markRead(n.id)
      if (n.server_id && n.channel_id) {
        const params = new URLSearchParams()
        if (n.message_id) {
          params.set("message", n.message_id)
          try {
            const { data: message } = await supabase
              .from("messages")
              .select("thread_id")
              .eq("id", n.message_id)
              .maybeSingle()
            if (message?.thread_id) params.set("thread", message.thread_id)
          } catch {}
        }
        const query = params.toString()
        router.push(`/channels/${n.server_id}/${n.channel_id}${query ? `?${query}` : ""}`)
      }
    } catch (error) {
      console.error("Failed to handle notification click", error)
    }
  }

  const filtered = notifications.filter((n) => {
    if (filter === "unread") return !n.read
    if (filter === "mentions") return n.type === "mention"
    return true
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--theme-bg-tertiary)" }}
      >
        <span className="font-semibold text-white">Notifications</span>
        {totalUnreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors hover:bg-white/10"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--theme-bg-tertiary)" }}>
        {(["all", "unread", "mentions"] as const).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors"
            style={{
              background: filter === f ? "rgba(255,255,255,0.1)" : "transparent",
              color: filter === f ? "var(--theme-text-primary)" : "var(--theme-text-muted)",
            }}
          >
            {f}
            {f === "unread" && totalUnreadCount > 0 && (
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: "var(--theme-danger)", color: "white" }}
              >
                {totalUnreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-1 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Bell className="w-10 h-10" style={{ color: "var(--theme-text-faint)" }} />
            <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
              {filter === "all" ? "All caught up!" : filter === "unread" ? "No unread notifications" : "No mentions"}
            </p>
          </div>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              className="flex items-start gap-3 px-4 py-3 border-b transition-colors hover:bg-white/[0.03]"
              style={{
                borderColor: "var(--theme-bg-tertiary)",
                background: n.read ? "transparent" : "rgba(88,101,242,0.05)",
              }}
            >
              <button
                type="button"
                onClick={() => handleClick(n)}
                className="flex flex-1 min-w-0 items-start gap-3 text-left"
              >
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
                  style={{
                    background: n.read ? "var(--theme-surface-input)" : "var(--theme-accent)",
                    color: "white",
                  }}
                >
                  {TYPE_ICONS[n.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: n.read ? "var(--theme-text-secondary)" : "var(--theme-text-primary)" }}
                  >
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-xs truncate mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
                      {n.body}
                    </p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-faint)" }}>
                    {format(new Date(n.created_at), "MMM d, h:mm a")}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-1 flex-shrink-0 mt-1">
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    style={{ color: "var(--theme-text-muted)" }}
                    title="Mark as read"
                    aria-label="Mark as read"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(n.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                  style={{ color: "var(--theme-text-faint)" }}
                  title="Dismiss"
                  aria-label="Dismiss notification"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
