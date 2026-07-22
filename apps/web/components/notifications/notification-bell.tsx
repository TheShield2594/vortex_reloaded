"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, CheckCheck, Hash, AtSign, UserPlus, Trash2, X } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { useNotificationPreferences } from "@/hooks/use-notification-preferences"
import { shouldNotify, showBrowserNotification } from "@/lib/notification-manager"
import { format } from "date-fns"

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

function isNotification(obj: unknown): obj is Notification {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    typeof (obj as Record<string, unknown>).id === "string" &&
    "type" in obj &&
    "title" in obj
  )
}

const TYPE_ICONS: Record<Notification["type"], React.ReactNode> = {
  mention: <AtSign className="w-3.5 h-3.5" />,
  reply: <Hash className="w-3.5 h-3.5" />,
  friend_request: <UserPlus className="w-3.5 h-3.5" />,
  server_invite: <Hash className="w-3.5 h-3.5" />,
  system: <Bell className="w-3.5 h-3.5" />,
}

interface Props {
  userId: string
  variant?: "icon" | "sidebar"
}

export function NotificationBell({ userId, variant = "icon" }: Props) {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const router = useRouter()
  const { playNotification } = useNotificationSound()
  const { prefs } = useNotificationPreferences(userId)
  const soundEnabledRef = useRef(prefs.sound_enabled)
  const subIdRef = useRef(0)
  soundEnabledRef.current = prefs.sound_enabled
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filterTab, setFilterTab] = useState<"all" | "mentions" | "other">("all")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  /** Count unread mentions (type=mention) for favicon numeric badge */
  const computeMentionCount = useCallback((items: Notification[]): number => {
    return items.filter((n) => !n.read && n.type === "mention").length
  }, [])

  const filteredNotifications = useMemo(() => {
    if (filterTab === "all") return notifications
    if (filterTab === "mentions") return notifications.filter((n) => n.type === "mention" || n.type === "reply")
    return notifications.filter((n) => n.type !== "mention" && n.type !== "reply")
  }, [notifications, filterTab])

  const tabUnreadCounts = useMemo(() => {
    const mentions = notifications.filter((n) => !n.read && (n.type === "mention" || n.type === "reply")).length
    const other = notifications.filter((n) => !n.read && n.type !== "mention" && n.type !== "reply").length
    return { all: mentions + other, mentions, other }
  }, [notifications])

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30")
      if (!res.ok) throw new Error("Failed to fetch")
      const { notifications: data } = await res.json() as { notifications: Notification[] }
      setNotifications(data)
      setUnreadCount(data.filter((n) => !n.read).length)
    } catch (error) {
      console.error("Failed to load notifications:", error)
      setNotifications([])
      setUnreadCount(0)
    }
  }, [])

  useEffect(() => { loadNotifications() }, [loadNotifications])

  // Real-time: listen for new notifications
  useEffect(() => {
    const subId = ++subIdRef.current
    const ch = supabase
      .channel(`notifications:${userId}:${subId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!isNotification(payload.new)) return
          const n = payload.new
          setNotifications((prev) => [n, ...prev.slice(0, 29)])
          setUnreadCount((c) => c + 1)

          // Focused-window suppression (Fluxer-style):
          // - Viewing the same channel → no sound, no browser notification
          // - App focused, different channel → sound only
          // - App not focused → sound + browser notification
          const { shouldPlaySound, shouldShowBrowserNotification } = shouldNotify({
            channelId: n.channel_id,
            messageId: n.message_id,
          })

          if (shouldPlaySound && soundEnabledRef.current) {
            const soundType = n.type === "mention" ? "mention" as const : "message" as const
            playNotification(soundType)
          }

          if (shouldShowBrowserNotification && n.title) {
            const url = n.server_id && n.channel_id
              ? `/channels/${n.server_id}/${n.channel_id}${n.message_id ? `?message=${n.message_id}` : ""}`
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
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload: { new: unknown }) => {
          if (!isNotification(payload.new)) return
          const updated = payload.new
          setNotifications((prev: Notification[]) => {
            const next = prev.map((n: Notification) => (n.id === updated.id ? updated : n))
            setUnreadCount(next.filter((n: Notification) => !n.read).length)
            return next
          })
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const old = payload.old as { id?: string; read?: boolean }
          if (old.id) {
            setNotifications((prev) => prev.filter((n) => n.id !== old.id))
            if (old.read === false) setUnreadCount((c) => Math.max(0, c - 1))
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [userId, supabase])

  // Sync unread + mention counts to Zustand store (consumed by useTabUnreadTitle)
  useEffect(() => {
    useAppStore.setState({
      notificationUnreadCount: unreadCount,
      notificationMentionCount: computeMentionCount(notifications),
    })
  }, [unreadCount, notifications, computeMentionCount])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", handler)
    return () => document.removeEventListener("pointerdown", handler)
  }, [open])

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",")

    const getFocusable = () =>
      panel
        ? (Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
            (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
          ))
        : []

    const firstFocusable = getFocusable()[0]
    ;(firstFocusable ?? panel)?.focus()

    function handlePanelKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        return
      }

      if (event.key !== "Tab") return
      const focusable = getFocusable()
      if (focusable.length === 0) {
        event.preventDefault()
        panel?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || active === panel) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handlePanelKeys)
    return () => {
      document.removeEventListener("keydown", handlePanelKeys)
      triggerRef.current?.focus()
    }
  }, [open])

  async function markAllRead(): Promise<void> {
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
    setUnreadCount(0)
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
    setNotifications((prev) => {
      const wasUnread = prev.find((n) => n.id === id && !n.read)
      if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1))
      return prev.map((n) => n.id === id ? { ...n, read: true } : n)
    })
  }

  async function dismiss(id: string): Promise<void> {
    const target = notifications.find((x) => x.id === id)
    // Optimistic removal
    setNotifications((prev) => prev.filter((x) => x.id !== id))
    if (target && !target.read) setUnreadCount((c) => Math.max(0, c - 1))

    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        throw new Error("Failed to dismiss notification")
      }
    } catch (error) {
      console.error("Failed to dismiss notification", error)
      if (target) {
        setNotifications((prev) => {
          const restored = [...prev, target].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          return restored
        })
        if (!target.read) setUnreadCount((c) => c + 1)
      }
    }
  }

  async function dismissAll(): Promise<void> {
    const prev = notifications
    const prevUnread = unreadCount
    const ids = prev.map((n) => n.id)
    if (ids.length === 0) return
    // Optimistic clear — only the visible notifications
    setNotifications([])
    setUnreadCount(0)

    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) {
        throw new Error("Failed to clear all notifications")
      }
    } catch (error) {
      console.error("Failed to clear all notifications", error)
      setNotifications(prev)
      setUnreadCount(prevUnread)
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

            const threadId = message?.thread_id
            if (threadId) params.set("thread", threadId)
          } catch (error) {
            console.error("Failed to resolve thread context from notification", error)
          }
      }

      const query = params.toString()
      router.push(`/channels/${n.server_id}/${n.channel_id}${query ? `?${query}` : ""}`)
      setOpen(false)
      }
    } catch (error) {
      console.error("Failed to handle notification click", error)
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      {/* Bell button */}
      {variant === "sidebar" ? (
        <button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          className="relative flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-white/10 focus-ring"
          title="Inbox"
          aria-label="Open inbox"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Inbox
          </span>
          {unreadCount > 0 && (
            <span
              className="notification-badge min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-bold flex items-center justify-center"
              style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
            >
              <span className="notification-badge-count">{unreadCount > 99 ? "99+" : unreadCount}</span>
            </span>
          )}
        </button>
      ) : (
        <button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          className="relative w-9 h-9 flex items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-ring"
          style={{ color: open ? "var(--theme-text-primary)" : "var(--theme-text-muted)" }}
          title="Notifications"
          aria-label="Open notifications"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span
              className="notification-badge absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-xs font-bold px-0.5"
              style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)", fontSize: "10px" }}
            >
              <span className="notification-badge-count">{unreadCount > 99 ? "99+" : unreadCount}</span>
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications inbox"
          tabIndex={-1}
          className={`absolute w-80 rounded-xl shadow-2xl overflow-hidden z-50 ${variant === "sidebar" ? "left-full top-0 ml-2" : "right-0 top-full mt-2"}`}
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs transition-colors hover:text-white focus-ring rounded px-1"
                  style={{ color: "var(--theme-text-muted)" }}
                  title="Mark all as read"
                  aria-label="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={dismissAll}
                  className="flex items-center gap-1 text-xs transition-colors hover:text-white focus-ring rounded px-1"
                  style={{ color: "var(--theme-text-muted)" }}
                  title="Clear all notifications"
                  aria-label="Clear all notifications"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear all
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="h-6 w-6 inline-flex items-center justify-center rounded transition-colors hover:bg-white/10 focus-ring tertiary-metadata"
                title="Close notifications"
                aria-label="Close notifications"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b" style={{ borderColor: "var(--theme-bg-tertiary)" }} role="tablist" aria-label="Notification filters">
            {(["all", "mentions", "other"] as const).map((tab) => {
              const label = tab === "all" ? "All" : tab === "mentions" ? "Mentions" : "Other"
              const count = tabUnreadCounts[tab]
              const active = filterTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  id={`notifications-tab-${tab}`}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors"
                  style={{
                    color: active ? "var(--theme-text-primary)" : "var(--theme-text-muted)",
                    borderBottom: active ? "2px solid var(--theme-accent)" : "2px solid transparent",
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className="min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold px-1"
                      style={{ background: active ? "var(--theme-accent)" : "var(--theme-bg-tertiary)", color: active ? "white" : "var(--theme-text-muted)" }}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Bell className="w-8 h-8 tertiary-metadata" />
                <p className="text-sm tertiary-metadata">All caught up!</p>
              </div>
            ) : (
              filteredNotifications.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start justify-between gap-2 px-4 py-3 border-b transition-colors hover:bg-white/5"
                  style={{ borderColor: "var(--theme-bg-tertiary)", background: n.read ? "transparent" : "rgba(88,101,242,0.05)" }}
                  role="group"
                  aria-label={`Notification: ${n.title}`}
                >
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className="flex flex-1 min-w-0 items-start gap-3 text-left rounded-sm focus-ring"
                    aria-label={`Open notification: ${n.title}`}
                  >
                    {/* Type icon */}
                    <div
                      className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
                      style={{ background: n.read ? "var(--theme-surface-input)" : "var(--theme-accent)", color: "white" }}
                    >
                      {TYPE_ICONS[n.type]}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: n.read ? "var(--theme-text-secondary)" : "var(--theme-text-primary)" }}>{n.title}</p>
                      {n.body && (
                        <p className="text-xs truncate mt-0.5 tertiary-metadata">{n.body}</p>
                      )}
                      <p className="text-xs mt-0.5 tertiary-metadata">
                        {format(new Date(n.created_at), "MMM d, h:mm a")}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    {!n.read && (
                      <button
                        onClick={(e) => { e.stopPropagation(); markRead(n.id) }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 focus-ring"
                        style={{ color: "var(--theme-text-muted)" }}
                        title={`Mark "${n.title}" as read`}
                        aria-label={`Mark "${n.title}" as read`}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 focus-ring tertiary-metadata"
                      title={`Dismiss "${n.title}" notification`}
                      aria-label={`Dismiss "${n.title}" notification`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
