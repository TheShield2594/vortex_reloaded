"use client"

import { useEffect, useState } from "react"
import { ClipboardList, Plus, Trash2, Save, Users, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface Channel { id: string; name: string; type: string }

interface StandupConfig {
  server_id: string
  channel_id: string | null
  reminder_time: string
  timezone: string
  questions: string[]
  days_active: number[]
  enabled: boolean
}

interface StandupEntry {
  id: string
  user_id: string
  answers: string[]
  standup_date: string
  submitted_at: string
  users: { display_name: string | null; username: string | null; avatar_url: string | null } | null
}

interface Props { serverId: string }

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function StandupAppConfig({ serverId }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [entries, setEntries] = useState<StandupEntry[]>([])
  const [config, setConfig] = useState<StandupConfig>({
    server_id: serverId,
    channel_id: null,
    reminder_time: "09:00:00",
    timezone: "UTC",
    questions: ["What did you do yesterday?", "What are you working on today?", "Any blockers?"],
    days_active: [1, 2, 3, 4, 5],
    enabled: true,
  })
  const [newQuestion, setNewQuestion] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [myAnswers, setMyAnswers] = useState<string[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [standupRes, channelsRes] = await Promise.all([
          fetch(`/api/servers/${serverId}/apps/standup`),
          fetch(`/api/servers/${serverId}/channels`),
        ])

        if (standupRes.ok) {
          const data = await standupRes.json()
          if (data.config) {
            setConfig({
              ...data.config,
              questions: Array.isArray(data.config.questions) ? data.config.questions : [],
              days_active: Array.isArray(data.config.days_active) ? data.config.days_active : [1,2,3,4,5],
            })
            setMyAnswers(new Array(data.config.questions?.length ?? 3).fill(""))
          }
          setEntries(data.entries ?? [])
          setCurrentUserId(data.currentUserId ?? null)
        }

        if (channelsRes.ok) {
          const channelData = await channelsRes.json()
          setChannels((Array.isArray(channelData) ? channelData : []).filter((c: Channel) => c.type === "text"))
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load standup config" })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serverId])

  async function saveConfig() {
    setSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/standup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_config", ...config }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed")
      toast({ title: "Standup config saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  async function submitStandup() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/standup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_standup", answers: myAnswers }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Submit failed")
      toast({ title: "Standup submitted!" })
      // Refresh entries
      const refreshRes = await fetch(`/api/servers/${serverId}/apps/standup`)
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        setEntries(data.entries ?? [])
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Submit failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSubmitting(false)
    }
  }

  function addQuestion() {
    const trimmed = newQuestion.trim()
    if (!trimmed || config.questions.length >= 10) return
    setConfig({ ...config, questions: [...config.questions, trimmed] })
    setMyAnswers([...myAnswers, ""])
    setNewQuestion("")
  }

  function removeQuestion(index: number) {
    setConfig({ ...config, questions: config.questions.filter((_, i) => i !== index) })
    setMyAnswers(myAnswers.filter((_, i) => i !== index))
  }

  function toggleDay(day: number) {
    const active = config.days_active.includes(day)
      ? config.days_active.filter((d) => d !== day)
      : [...config.days_active, day].sort()
    setConfig({ ...config, days_active: active })
  }

  const alreadySubmitted = entries.some((e) => e.user_id === currentUserId)

  if (loading) return <p style={{ color: "var(--theme-text-muted)" }}>Loading standup config...</p>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          <ClipboardList className="w-4 h-4 inline mr-1.5" />
          Standup Assistant
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor="standup-enabled" style={{ color: "var(--theme-text-muted)" }} className="text-sm">Enabled</Label>
          <Switch id="standup-enabled" checked={config.enabled} onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })} />
        </div>
      </div>

      {/* Channel */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Standup Channel</Label>
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

      {/* Schedule */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
            <Clock className="w-3 h-3 inline mr-1" />Reminder Time
          </Label>
          <Input
            type="time"
            value={config.reminder_time.slice(0, 5)}
            onChange={(e) => setConfig({ ...config, reminder_time: e.target.value + ":00" })}
          />
        </div>
        <div className="space-y-1.5">
          <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Timezone</Label>
          <Input
            value={config.timezone}
            onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
            placeholder="UTC"
          />
        </div>
      </div>

      {/* Active Days */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Active Days</Label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <button
              key={day}
              onClick={() => toggleDay(day)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
              style={{
                background: config.days_active.includes(day) ? "var(--theme-accent)" : "var(--theme-bg-primary)",
                color: config.days_active.includes(day) ? "#fff" : "var(--theme-text-muted)",
                border: "1px solid var(--theme-surface-elevated)",
              }}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
          Standup Questions ({config.questions.length}/10)
        </Label>
        <div className="space-y-1.5">
          {config.questions.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs w-5 text-right flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>{i + 1}.</span>
              <span className="flex-1 text-sm rounded px-2 py-1" style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)" }}>{q}</span>
              <button onClick={() => removeQuestion(i)} className="flex-shrink-0" aria-label={`Remove question ${i + 1}`}>
                <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--theme-danger, #f04747)" }} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQuestion() } }} placeholder="Add a question..." className="flex-1" />
          <Button size="sm" onClick={addQuestion} disabled={!newQuestion.trim() || config.questions.length >= 10}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Button onClick={saveConfig} disabled={saving} className="motion-interactive">
        <Save className="w-4 h-4 mr-1.5" />
        {saving ? "Saving..." : "Save Configuration"}
      </Button>

      {/* Submit standup section */}
      <div className="border-t pt-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
        <p className="text-sm font-medium mb-3" style={{ color: "var(--theme-text-bright)" }}>
          {alreadySubmitted ? "You've already submitted today's standup" : "Submit Your Standup"}
        </p>
        {!alreadySubmitted && (
          <div className="space-y-2">
            {config.questions.map((q, i) => (
              <div key={i} className="space-y-1">
                <Label className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{q}</Label>
                <Input
                  value={myAnswers[i] || ""}
                  onChange={(e) => {
                    const updated = [...myAnswers]
                    updated[i] = e.target.value
                    setMyAnswers(updated)
                  }}
                  placeholder="Your answer..."
                  maxLength={500}
                />
              </div>
            ))}
            <Button size="sm" onClick={submitStandup} disabled={submitting || myAnswers.every((a) => !a.trim())}>
              {submitting ? "Submitting..." : "Submit Standup"}
            </Button>
          </div>
        )}
      </div>

      {/* Today's entries */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
            <Users className="w-3.5 h-3.5 inline mr-1" />
            Today's Standups ({entries.length})
          </p>
          {entries.map((entry) => {
            const name = entry.users?.display_name || entry.users?.username || "Unknown"
            const answers = Array.isArray(entry.answers) ? entry.answers : []
            return (
              <div key={entry.id} className="rounded border p-3" style={{ borderColor: "var(--theme-surface-elevated)" }}>
                <p className="text-sm font-medium mb-1" style={{ color: "var(--theme-text-bright)" }}>{name}</p>
                {config.questions.map((q, i) => (
                  <div key={i} className="mb-1">
                    <p className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>{q}</p>
                    <p className="text-sm" style={{ color: "var(--theme-text-normal)" }}>{answers[i] || "—"}</p>
                  </div>
                ))}
                <p className="text-xs mt-1" style={{ color: "var(--theme-text-muted)" }}>
                  {new Date(entry.submitted_at).toLocaleTimeString()}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
