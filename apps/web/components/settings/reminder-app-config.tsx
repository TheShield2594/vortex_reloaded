"use client"

import { useEffect, useState } from "react"
import { Bell, Save, Trash2, Plus, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface Channel { id: string; name: string; type: string }

interface ReminderConfig {
  server_id: string
  channel_id: string | null
  max_reminders_per_user: number
  enabled: boolean
}

interface Reminder {
  id: string
  user_id: string
  channel_id: string
  message: string
  remind_at: string
  delivered: boolean
  created_at: string
}

interface Props { serverId: string }

function formatTimeLeft(remindAt: string): string {
  const diff = new Date(remindAt).getTime() - Date.now()
  if (diff <= 0) return "any moment now"
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`
}

function parseTimeInput(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours?)$/i)
  if (!match) return null
  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  if (unit.startsWith("h")) return value * 60
  return value
}

export function ReminderAppConfig({ serverId }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [config, setConfig] = useState<ReminderConfig>({
    server_id: serverId,
    channel_id: null,
    max_reminders_per_user: 10,
    enabled: true,
  })
  const [newTime, setNewTime] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [reminderRes, channelsRes] = await Promise.all([
          fetch(`/api/servers/${serverId}/apps/reminder`),
          fetch(`/api/servers/${serverId}/channels`),
        ])

        if (reminderRes.ok) {
          const data = await reminderRes.json()
          if (data.config) setConfig(data.config)
          setReminders(data.reminders ?? [])
        }

        if (channelsRes.ok) {
          const channelData = await channelsRes.json()
          setChannels((Array.isArray(channelData) ? channelData : []).filter((c: Channel) => c.type === "text"))
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load reminder config" })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serverId])

  async function saveConfig() {
    setSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_config", ...config }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed")
      toast({ title: "Reminder config saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  async function createReminder() {
    const minutes = parseTimeInput(newTime)
    if (minutes === null || minutes < 1 || minutes > 1440) {
      toast({ variant: "destructive", title: "Invalid time", description: "Use a value like '30m' or '2h' (max 24h)" })
      return
    }
    if (!newMessage.trim()) {
      toast({ variant: "destructive", title: "Message required" })
      return
    }

    setCreating(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_reminder", minutes, message: newMessage.trim() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Create failed")
      toast({ title: "Reminder set!" })
      setNewTime("")
      setNewMessage("")
      // Refresh
      const refreshRes = await fetch(`/api/servers/${serverId}/apps/reminder`)
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        setReminders(data.reminders ?? [])
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create reminder", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setCreating(false)
    }
  }

  async function cancelReminder(reminderId: string) {
    setDeletingId(reminderId)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_reminder", reminder_id: reminderId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Cancel failed")
      setReminders(reminders.filter((r) => r.id !== reminderId))
      toast({ title: "Reminder cancelled" })
    } catch (err) {
      toast({ variant: "destructive", title: "Cancel failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setDeletingId(null)
    }
  }

  const activeReminders = reminders.filter((r) => !r.delivered)

  if (loading) return <p style={{ color: "var(--theme-text-muted)" }}>Loading reminder config...</p>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          <Bell className="w-4 h-4 inline mr-1.5" />
          Reminder Bot
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor="reminder-enabled" style={{ color: "var(--theme-text-muted)" }} className="text-sm">Enabled</Label>
          <Switch id="reminder-enabled" checked={config.enabled} onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })} />
        </div>
      </div>

      {/* Default Channel */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Default Reminder Channel</Label>
        <select
          value={config.channel_id || ""}
          onChange={(e) => setConfig({ ...config, channel_id: e.target.value || null })}
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
        >
          <option value="">Select a channel...</option>
          {channels.map((ch) => <option key={ch.id} value={ch.id}># {ch.name}</option>)}
        </select>
      </div>

      {/* Max reminders per user */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Max Reminders Per User</Label>
        <Input
          type="number"
          min={1}
          max={25}
          value={config.max_reminders_per_user}
          onChange={(e) => setConfig({ ...config, max_reminders_per_user: Math.min(25, Math.max(1, parseInt(e.target.value) || 1)) })}
          className="w-32"
        />
      </div>

      <Button onClick={saveConfig} disabled={saving} className="motion-interactive">
        <Save className="w-4 h-4 mr-1.5" />
        {saving ? "Saving..." : "Save Configuration"}
      </Button>

      {/* Create reminder */}
      <div className="border-t pt-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
        <p className="text-sm font-medium mb-3" style={{ color: "var(--theme-text-bright)" }}>
          <Plus className="w-3.5 h-3.5 inline mr-1" />
          Set a Reminder
        </p>
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="w-32">
              <Input
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                placeholder="e.g. 30m, 2h"
                maxLength={10}
              />
            </div>
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createReminder() } }}
              placeholder="Reminder message..."
              maxLength={500}
              className="flex-1"
            />
          </div>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            <Clock className="w-3 h-3 inline mr-1" />
            Max 24 hours. Use formats like 30m, 1h, 2hrs, 90min.
          </p>
          <Button size="sm" onClick={createReminder} disabled={creating || !newTime.trim() || !newMessage.trim()}>
            {creating ? "Setting..." : "Set Reminder"}
          </Button>
        </div>
      </div>

      {/* Active reminders */}
      {activeReminders.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
            <Bell className="w-3.5 h-3.5 inline mr-1" />
            Your Active Reminders ({activeReminders.length})
          </p>
          {activeReminders.map((reminder) => (
            <div key={reminder.id} className="rounded border p-3 flex items-center justify-between" style={{ borderColor: "var(--theme-surface-elevated)" }}>
              <div>
                <p className="text-sm" style={{ color: "var(--theme-text-normal)" }}>{reminder.message}</p>
                <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  <Clock className="w-3 h-3 inline mr-1" />
                  In {formatTimeLeft(reminder.remind_at)} ({new Date(reminder.remind_at).toLocaleTimeString()})
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={deletingId === reminder.id}
                onClick={() => cancelReminder(reminder.id)}
                aria-label="Cancel reminder"
              >
                <Trash2 className="w-4 h-4" style={{ color: "var(--theme-danger, #f04747)" }} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
