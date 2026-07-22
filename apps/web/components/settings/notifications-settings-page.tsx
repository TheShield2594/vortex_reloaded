"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Bell, BellOff, Volume2, VolumeX, Moon, Loader2, Send, Monitor, Smartphone, Eye, EyeOff, Hash, AtSign, ChevronDown } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import type { NotificationMode } from "@/lib/notification-resolver"

function DesktopNotificationSection(): React.ReactNode {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default")

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("Notification" in window)) {
      setPermission("unsupported")
      return
    }
    setPermission(Notification.permission)
  }, [])

  async function requestPermission(): Promise<void> {
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
    } catch {
      // Browser doesn't support notification permission request
    }
  }

  const isSupported = permission !== "unsupported"

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
        Desktop Notifications
      </h2>
      <p className="text-xs mb-2" style={{ color: "var(--theme-text-muted)" }}>
        Show desktop notifications for messages, mentions, and DMs when VortexChat is not focused.
      </p>
      <div
        className="flex items-center justify-between px-4 py-3 rounded-lg"
        style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
      >
        <div className="flex items-center gap-3">
          <Monitor className="w-4 h-4" style={{ color: permission === "granted" ? "var(--theme-accent)" : "var(--theme-text-muted)" }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>
              {permission === "unsupported" ? "Desktop notifications unavailable" : permission === "granted" ? "Desktop notifications enabled" : permission === "denied" ? "Desktop notifications blocked" : "Enable desktop notifications"}
            </p>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
              {permission === "unsupported"
                ? "Your browser does not support desktop notifications."
                : permission === "granted"
                  ? "You'll receive browser notifications for messages and mentions."
                  : permission === "denied"
                    ? "Notifications are blocked by your browser. Allow them in your browser's site settings."
                    : "Allow VortexChat to send you desktop notifications."}
            </p>
          </div>
        </div>
        {isSupported && permission === "default" && (
          <button
            type="button"
            onClick={requestPermission}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{ background: "var(--theme-accent)", color: "#fff" }}
          >
            Enable
          </button>
        )}
        {permission === "granted" && (
          <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: "rgba(67,181,129,0.15)", color: "var(--theme-success, #43b581)" }}>
            Active
          </span>
        )}
        {permission === "denied" && (
          <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: "rgba(242,63,67,0.15)", color: "var(--theme-danger)" }}>
            Blocked
          </span>
        )}
        {permission === "unsupported" && (
          <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "var(--theme-text-muted)" }}>
            Unsupported
          </span>
        )}
      </div>
    </section>
  )
}

interface Props {
  userId: string
}

type NotificationSettingsRow = {
  mention_notifications: boolean
  reply_notifications: boolean
  friend_request_notifications: boolean
  server_invite_notifications: boolean
  system_notifications: boolean
  sound_enabled: boolean
  notification_volume: number
  suppress_everyone: boolean
  suppress_role_mentions: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_timezone: string
  push_notifications: boolean
  show_message_preview: boolean
  show_unread_badge: boolean
}

type BooleanSettingKey = "mention_notifications" | "reply_notifications" | "friend_request_notifications" | "server_invite_notifications" | "system_notifications" | "sound_enabled" | "suppress_everyone" | "suppress_role_mentions" | "quiet_hours_enabled" | "push_notifications" | "show_message_preview" | "show_unread_badge"

const SETTING_LABELS: { key: BooleanSettingKey; label: string; description: string }[] = [
  { key: "mention_notifications", label: "Mentions", description: "When someone @mentions you in a channel" },
  { key: "reply_notifications", label: "Replies", description: "When someone replies to your message" },
  { key: "friend_request_notifications", label: "Friend Requests", description: "When you receive a new friend request" },
  { key: "server_invite_notifications", label: "Server Invites", description: "When you're invited to a server" },
  { key: "system_notifications", label: "System", description: "VortexChat announcements and updates" },
  { key: "sound_enabled", label: "Notification Sounds", description: "Play a sound when you receive a notification" },
]

const DEFAULT_SETTINGS: NotificationSettingsRow = {
  mention_notifications: true,
  reply_notifications: true,
  friend_request_notifications: true,
  server_invite_notifications: true,
  system_notifications: true,
  sound_enabled: true,
  notification_volume: 0.5,
  suppress_everyone: false,
  suppress_role_mentions: false,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
  quiet_hours_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  push_notifications: true,
  show_message_preview: true,
  show_unread_badge: true,
}

const MODE_OPTIONS: { mode: NotificationMode; label: string; icon: React.ReactNode }[] = [
  { mode: "all", label: "All Messages", icon: <Hash className="w-3.5 h-3.5" /> },
  { mode: "mentions", label: "Only @Mentions", icon: <AtSign className="w-3.5 h-3.5" /> },
  { mode: "muted", label: "Nothing", icon: <BellOff className="w-3.5 h-3.5" /> },
]

// localStorage key kept for sound_enabled cross-component sync
const soundStorageKey = (userId: string) => `vortexchat:notif-sound:${userId}`
// The hook reads from this key — keep it in sync when the user changes preferences
const GLOBAL_SOUND_STORAGE_KEY = "vortexchat:notification-sound-enabled"

export function NotificationsSettingsPage({ userId }: Props) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<NotificationSettingsRow>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingSend, setTestingSend] = useState(false)
  const [savingServerIds, setSavingServerIds] = useState<Record<string, boolean>>({})
  const { servers, notificationModes, setNotificationMode, removeNotificationMode } = useAppStore(
    useShallow((s) => ({
      servers: s.servers,
      notificationModes: s.notificationModes,
      setNotificationMode: s.setNotificationMode,
      removeNotificationMode: s.removeNotificationMode,
    }))
  )

  useEffect(() => {
    fetch("/api/user/notification-preferences")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && typeof data === "object") {
          const validated = { ...DEFAULT_SETTINGS }
          for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof NotificationSettingsRow)[]) {
            const val = data[key]
            if (typeof val === "boolean") (validated as Record<string, boolean | string | number>)[key] = val
            else if (typeof val === "string") (validated as Record<string, boolean | string | number>)[key] = val
            else if (typeof val === "number") (validated as Record<string, boolean | string | number>)[key] = val
          }
          setSettings(validated)
          // Keep sound pref in localStorage for use-notification-sound hook
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(soundStorageKey(userId), String(validated.sound_enabled))
              // Also sync the global key that the sound hook reads
              window.localStorage.setItem(GLOBAL_SOUND_STORAGE_KEY, validated.sound_enabled ? "true" : "false")
            } catch { /* ignore */ }
          }
        }
      })
      .catch(() => {
        // Fall back to localStorage if API unavailable
        if (typeof window !== "undefined") {
          try {
            const stored = window.localStorage.getItem(`vortexchat:notif-prefs:${userId}`)
            if (stored) {
              const parsed = JSON.parse(stored) as Record<string, unknown>
              const validated = { ...DEFAULT_SETTINGS }
              for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof NotificationSettingsRow)[]) {
                const val = parsed[key]
                if (typeof val === "boolean") (validated as Record<string, boolean | string | number>)[key] = val
                else if (typeof val === "string") (validated as Record<string, boolean | string | number>)[key] = val
                else if (typeof val === "number") (validated as Record<string, boolean | string | number>)[key] = val
              }
              setSettings(validated)
            }
          } catch { /* ignore */ }
        }
      })
      .finally(() => setLoading(false))
  }, [userId])

  const persistSetting = useCallback(async (next: NotificationSettingsRow) => {
    setSaving(true)
    try {
      const res = await fetch("/api/user/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        throw new Error("Failed to save preference")
      }
      // Mirror sound setting to localStorage so use-notification-sound hook picks it up
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(soundStorageKey(userId), String(next.sound_enabled))
          // Also sync the global key that the sound hook reads
          const globalValue = next.sound_enabled ? "true" : "false"
          window.localStorage.setItem(GLOBAL_SOUND_STORAGE_KEY, globalValue)
          // Dispatch storage event so cross-tab hook reacts
          window.dispatchEvent(new StorageEvent("storage", {
            key: GLOBAL_SOUND_STORAGE_KEY,
            newValue: globalValue,
          }))
        } catch { /* ignore */ }
      }
    } catch {
      toast({ title: "Failed to save preference", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }, [userId, toast])

  function handleToggle(key: BooleanSettingKey) {
    const next = { ...settings, [key]: !(settings[key] as boolean) }
    setSettings(next)
    void persistSetting(next)
  }

  function muteAll() {
    const next: NotificationSettingsRow = {
      ...settings,
      mention_notifications: false,
      reply_notifications: false,
      friend_request_notifications: false,
      server_invite_notifications: false,
      system_notifications: false,
      sound_enabled: false,
    }
    setSettings(next)
    void persistSetting(next)
    toast({ title: "All notifications muted" })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20" />
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
            Notifications
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
            Control which notifications you receive and how they're delivered.
          </p>
        </div>
        <button
          type="button"
          onClick={muteAll}
          disabled={saving}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all disabled:opacity-50"
          style={{
            background: "rgba(242,63,67,0.1)",
            color: "var(--theme-danger)",
            border: "1px solid rgba(242,63,67,0.25)",
          }}
        >
          <BellOff className="w-4 h-4" />
          Mute all
        </button>
      </div>

      {/* ── Desktop Notifications ────────── */}
      <DesktopNotificationSection />

      {/* ── Delivery & Display ────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Delivery & Display
        </h2>
        <p className="text-xs mb-2" style={{ color: "var(--theme-text-muted)" }}>
          Control how notifications are delivered and what they show.
        </p>
        {([
          { key: "push_notifications" as BooleanSettingKey, label: "Push Notifications", description: "Receive push notifications on your mobile device", icon: Smartphone },
          { key: "show_message_preview" as BooleanSettingKey, label: "Show Message Previews", description: "Display message content in desktop and push notifications", icon: Eye },
          { key: "show_unread_badge" as BooleanSettingKey, label: "Unread Badge", description: "Show unread count badge on the browser tab and app icon", icon: Bell },
        ]).map(({ key, label, description, icon: Icon }) => {
          const enabled = settings[key] as boolean
          return (
            <div
              key={key}
              className="flex items-center justify-between px-4 py-3 rounded-lg"
              style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
            >
              <div className="flex items-center gap-3">
                {enabled
                  ? <Icon className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
                  : (key === "show_message_preview" ? <EyeOff className="w-4 h-4" style={{ color: "var(--theme-text-muted)" }} /> : <Icon className="w-4 h-4" style={{ color: "var(--theme-text-muted)" }} />)
                }
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>{label}</p>
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(key)}
                disabled={saving}
                className="relative w-10 h-6 rounded-full transition-all focus-ring disabled:opacity-50"
                style={{ background: enabled ? "var(--theme-accent)" : "var(--theme-bg-tertiary)" }}
                role="switch"
                aria-checked={enabled}
                aria-label={label}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: enabled ? "translateX(16px)" : "translateX(0)" }}
                />
              </button>
            </div>
          )
        })}
      </section>

      {/* ── Server Notification Overrides ────────── */}
      {servers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            Server Notification Overrides
          </h2>
          <p className="text-xs mb-2" style={{ color: "var(--theme-text-muted)" }}>
            Customize notification behavior for each server. Servers not listed use your default settings.
          </p>
          <div className="space-y-1">
            {servers.map((server) => {
              const currentMode: NotificationMode = (notificationModes[server.id] as NotificationMode) ?? "all"
              const initials = server.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
              return (
                <div
                  key={server.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
                  style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
                >
                  <Avatar className="w-8 h-8 rounded-xl flex-shrink-0">
                    {server.icon_url && <AvatarImage src={server.icon_url} />}
                    <AvatarFallback className="rounded-xl text-[10px] font-bold" style={{ background: "var(--theme-accent)", color: "white" }}>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium flex-1 truncate" style={{ color: "var(--theme-text-primary)" }}>
                    {server.name}
                  </span>
                  <div className="relative flex-shrink-0">
                    <select
                      value={currentMode}
                      disabled={Boolean(savingServerIds[server.id])}
                      onChange={async (e) => {
                        const newMode = e.target.value as NotificationMode
                        const previousMode = currentMode
                        setSavingServerIds((prev) => ({ ...prev, [server.id]: true }))
                        if (newMode === "all") {
                          removeNotificationMode(server.id)
                        } else {
                          setNotificationMode(server.id, newMode)
                        }
                        try {
                          const res = await fetch("/api/notification-settings", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ serverId: server.id, mode: newMode }),
                          })
                          if (!res.ok) throw new Error("Failed to save notification setting")
                        } catch {
                          // Rollback optimistic update
                          if (previousMode === "all") {
                            removeNotificationMode(server.id)
                          } else {
                            setNotificationMode(server.id, previousMode)
                          }
                          toast({ title: "Failed to update server notification", variant: "destructive" })
                        } finally {
                          setSavingServerIds((prev) => { const next = { ...prev }; delete next[server.id]; return next })
                        }
                      }}
                      className="appearance-none pl-3 pr-8 py-1.5 rounded-md text-xs font-medium cursor-pointer focus-ring"
                      style={{
                        background: currentMode === "muted" ? "rgba(242,63,67,0.1)" : currentMode === "mentions" ? "rgba(88,101,242,0.1)" : "var(--theme-bg-tertiary)",
                        color: currentMode === "muted" ? "var(--theme-danger)" : currentMode === "mentions" ? "var(--theme-accent)" : "var(--theme-text-secondary)",
                        border: "1px solid var(--theme-bg-tertiary)",
                      }}
                      aria-label={`Notification mode for ${server.name}`}
                    >
                      {MODE_OPTIONS.map((opt) => (
                        <option key={opt.mode} value={opt.mode}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--theme-text-muted)" }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Notification Types
        </h2>

        {SETTING_LABELS.map(({ key, label, description }) => {
          const enabled = settings[key]
          const isSound = key === "sound_enabled"
          return (
            <div
              key={key}
              className="flex items-center justify-between px-4 py-3 rounded-lg"
              style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
            >
              <div className="flex items-center gap-3">
                {isSound
                  ? (enabled ? <Volume2 className="w-4 h-4" style={{ color: "var(--theme-accent)" }} /> : <VolumeX className="w-4 h-4" style={{ color: "var(--theme-text-muted)" }} />)
                  : (enabled ? <Bell className="w-4 h-4" style={{ color: "var(--theme-accent)" }} /> : <BellOff className="w-4 h-4" style={{ color: "var(--theme-text-muted)" }} />)
                }
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>{label}</p>
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{description}</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                type="button"
                onClick={() => handleToggle(key)}
                disabled={saving}
                className="relative w-10 h-6 rounded-full transition-all focus-ring disabled:opacity-50"
                style={{ background: enabled ? "var(--theme-accent)" : "var(--theme-bg-tertiary)" }}
                role="switch"
                aria-checked={enabled}
                aria-label={`${label} notifications`}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: enabled ? "translateX(16px)" : "translateX(0)" }}
                />
              </button>
            </div>
          )
        })}
      </section>

      {/* ── Volume slider (#612) ────────── */}
      {settings.sound_enabled && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            Notification Volume
          </h2>
          <div
            className="flex items-center gap-4 px-4 py-3 rounded-lg"
            style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
          >
            <VolumeX className="w-4 h-4 shrink-0" style={{ color: "var(--theme-text-muted)" }} />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(settings.notification_volume * 100)}
              onChange={(e) => {
                const vol = Number(e.target.value) / 100
                setSettings((prev) => ({ ...prev, notification_volume: vol }))
              }}
              onPointerUp={(e) => {
                const vol = Number((e.target as HTMLInputElement).value) / 100
                void persistSetting({ ...settings, notification_volume: vol })
              }}
              className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: "var(--theme-accent)" }}
              aria-label="Notification volume"
            />
            <Volume2 className="w-4 h-4 shrink-0" style={{ color: "var(--theme-accent)" }} />
            <span className="text-xs font-medium tabular-nums w-8 text-right" style={{ color: "var(--theme-text-primary)" }}>
              {Math.round(settings.notification_volume * 100)}%
            </span>
          </div>
          {settings.notification_volume === 0 && (
            <p className="text-xs px-1" style={{ color: "var(--theme-text-muted)" }}>
              Volume is at 0% — notifications will be silent but still visible.
            </p>
          )}
        </section>
      )}

      {/* ── Mention suppression (#607) ────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Mention Suppression
        </h2>
        <p className="text-xs mb-2" style={{ color: "var(--theme-text-muted)" }}>
          Block mass mentions without fully muting channels.
        </p>

        {([
          { key: "suppress_everyone" as BooleanSettingKey, label: "Suppress @everyone", description: "Block notifications from @everyone mentions" },
          { key: "suppress_role_mentions" as BooleanSettingKey, label: "Suppress @role mentions", description: "Block notifications from @role mentions" },
        ]).map(({ key, label, description }) => {
          const enabled = settings[key] as boolean
          return (
            <div
              key={key}
              className="flex items-center justify-between px-4 py-3 rounded-lg"
              style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
            >
              <div className="flex items-center gap-3">
                <BellOff className="w-4 h-4" style={{ color: enabled ? "var(--theme-accent)" : "var(--theme-text-muted)" }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>{label}</p>
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(key)}
                disabled={saving}
                className="relative w-10 h-6 rounded-full transition-all focus-ring disabled:opacity-50"
                style={{ background: enabled ? "var(--theme-accent)" : "var(--theme-bg-tertiary)" }}
                role="switch"
                aria-checked={enabled}
                aria-label={label}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: enabled ? "translateX(16px)" : "translateX(0)" }}
                />
              </button>
            </div>
          )
        })}
      </section>

      {/* ── Quiet hours ────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Quiet Hours
        </h2>
        <p className="text-xs mb-2" style={{ color: "var(--theme-text-muted)" }}>
          Suppress push notifications during a scheduled window each day.
        </p>

        {/* Enable toggle */}
        <div
          className="flex items-center justify-between px-4 py-3 rounded-lg"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div className="flex items-center gap-3">
            <Moon className="w-4 h-4" style={{ color: settings.quiet_hours_enabled ? "var(--theme-accent)" : "var(--theme-text-muted)" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>Enable quiet hours</p>
              <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Notifications will be silenced during the scheduled window</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleToggle("quiet_hours_enabled")}
            disabled={saving}
            className="relative w-10 h-6 rounded-full transition-all focus-ring disabled:opacity-50"
            style={{ background: settings.quiet_hours_enabled ? "var(--theme-accent)" : "var(--theme-bg-tertiary)" }}
            role="switch"
            aria-checked={settings.quiet_hours_enabled}
            aria-label="Enable quiet hours"
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
              style={{ transform: settings.quiet_hours_enabled ? "translateX(16px)" : "translateX(0)" }}
            />
          </button>
        </div>

        {/* Time pickers — only shown when enabled */}
        {settings.quiet_hours_enabled && (
          <div
            className="grid grid-cols-2 gap-3 px-4 py-3 rounded-lg"
            style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
          >
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>Start</span>
              <input
                type="time"
                value={settings.quiet_hours_start}
                onChange={(e) => {
                  const val = e.target.value
                  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) {
                    const next = { ...settings, quiet_hours_start: val }
                    setSettings(next)
                    void persistSetting(next)
                  }
                }}
                className="w-full rounded px-2 py-1.5 text-sm focus-ring"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-bright)", border: "1px solid var(--theme-bg-tertiary)" }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>End</span>
              <input
                type="time"
                value={settings.quiet_hours_end}
                onChange={(e) => {
                  const val = e.target.value
                  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) {
                    const next = { ...settings, quiet_hours_end: val }
                    setSettings(next)
                    void persistSetting(next)
                  }
                }}
                className="w-full rounded px-2 py-1.5 text-sm focus-ring"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-bright)", border: "1px solid var(--theme-bg-tertiary)" }}
              />
            </label>
            <div className="col-span-2">
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>Timezone</span>
                <select
                  value={settings.quiet_hours_timezone}
                  onChange={(e) => {
                    const next = { ...settings, quiet_hours_timezone: e.target.value }
                    setSettings(next)
                    void persistSetting(next)
                  }}
                  className="w-full rounded px-2 py-1.5 text-sm focus-ring"
                  style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-bright)", border: "1px solid var(--theme-bg-tertiary)" }}
                >
                  {Intl.supportedValuesOf?.("timeZone")?.map((tz: string) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  )) ?? (
                    <option value={settings.quiet_hours_timezone}>{settings.quiet_hours_timezone}</option>
                  )}
                </select>
              </label>
            </div>
          </div>
        )}
      </section>

      {/* ── Test notification (#609) ────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Test Notifications
        </h2>
        <div
          className="flex items-center justify-between px-4 py-3 rounded-lg"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <div className="flex items-center gap-3">
            <Send className="w-4 h-4" style={{ color: "var(--theme-text-muted)" }} />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>Send test notification</p>
              <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Verify push notifications are working on this device</p>
            </div>
          </div>
          <button
            type="button"
            disabled={testingSend}
            onClick={async () => {
              setTestingSend(true)
              try {
                const res = await fetch("/api/notifications/test", { method: "POST" })
                const data = await res.json() as { ok?: boolean; error?: string }
                if (!res.ok) {
                  toast({ title: data.error ?? "Failed to send test notification", variant: "destructive" })
                } else {
                  toast({ title: "Test notification sent! Check your device." })
                }
              } catch {
                toast({ title: "Network error sending test notification", variant: "destructive" })
              } finally {
                setTestingSend(false)
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {testingSend && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {testingSend ? "Sending…" : "Test"}
          </button>
        </div>
      </section>

      {/* ── Save ── */}
      <div className="flex items-center justify-between pt-2 pb-4">
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Per-server and per-channel notification overrides can be set by right-clicking on servers and channels.
        </p>
        <button
          type="button"
          onClick={async () => {
            await persistSetting(settings)
            toast({ title: "Notification preferences saved!" })
          }}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-md font-semibold text-sm transition-all hover:brightness-110 disabled:opacity-60 shrink-0 ml-4"
          style={{ background: "var(--theme-accent)", color: "white" }}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  )
}
