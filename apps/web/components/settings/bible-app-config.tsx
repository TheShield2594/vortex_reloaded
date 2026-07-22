"use client"

import { useEffect, useState } from "react"
import { BookOpen, Save, Key, Clock, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface Channel { id: string; name: string; type: string }

interface BibleConfig {
  server_id: string
  channel_id: string | null
  api_key?: string
  bible_id: string
  daily_verse_enabled: boolean
  daily_verse_time: string
  timezone: string
  embed_color: string
  enabled: boolean
}

interface BibleOption {
  id: string
  name: string
  abbreviation: string
  language: string
}

interface Props { serverId: string }

const COMMON_TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney", "Pacific/Auckland",
]

export function BibleAppConfig({ serverId }: Props): React.ReactElement {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [bibles, setBibles] = useState<BibleOption[]>([])
  const [loadingBibles, setLoadingBibles] = useState(false)
  const [posting, setPosting] = useState(false)
  const [config, setConfig] = useState<BibleConfig>({
    server_id: serverId,
    channel_id: null,
    api_key: "",
    bible_id: "de4e12af7f28f599-02",
    daily_verse_enabled: true,
    daily_verse_time: "08:00",
    timezone: "UTC",
    embed_color: "#C4A747",
    enabled: true,
  })

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true)
      try {
        const [bibleRes, channelsRes] = await Promise.all([
          fetch(`/api/servers/${serverId}/apps/bible`),
          fetch(`/api/servers/${serverId}/channels`),
        ])

        if (bibleRes.ok) {
          const data = await bibleRes.json()
          if (data.config) {
            setConfig({
              ...data.config,
              daily_verse_time: data.config.daily_verse_time?.substring(0, 5) || "08:00",
              api_key: "", // Don't pre-fill — server doesn't expose it in GET
            })
          }
        }

        if (channelsRes.ok) {
          const channelData = await channelsRes.json()
          setChannels((Array.isArray(channelData) ? channelData : []).filter((c: Channel) => c.type === "text"))
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load Bible Bot config" })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serverId])

  async function saveConfig(): Promise<void> {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        action: "save_config",
        channel_id: config.channel_id,
        bible_id: config.bible_id,
        daily_verse_enabled: config.daily_verse_enabled,
        daily_verse_time: config.daily_verse_time,
        timezone: config.timezone,
        embed_color: config.embed_color,
        enabled: config.enabled,
      }
      // Only send api_key if user typed something
      if (config.api_key && config.api_key.trim()) {
        payload.api_key = config.api_key.trim()
      }

      const res = await fetch(`/api/servers/${serverId}/apps/bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed")
      toast({ title: "Bible Bot config saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  async function loadBibles(): Promise<void> {
    setLoadingBibles(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_bibles" }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load Bibles")
      const data = await res.json()
      setBibles(data.bibles ?? [])
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to load Bible translations", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setLoadingBibles(false)
    }
  }

  async function postDailyVerse(): Promise<void> {
    setPosting(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post_daily_verse" }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Post failed")
      const data = await res.json()
      toast({ title: "Daily verse posted!", description: data.reference })
    } catch (err) {
      toast({ variant: "destructive", title: "Post failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setPosting(false)
    }
  }

  if (loading) return <p style={{ color: "var(--theme-text-muted)" }}>Loading Bible Bot config...</p>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          <BookOpen className="w-4 h-4 inline mr-1.5" />
          Bible Bot
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor="bible-enabled" style={{ color: "var(--theme-text-muted)" }} className="text-sm">Enabled</Label>
          <Switch id="bible-enabled" checked={config.enabled} onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })} />
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
          <Key className="w-3 h-3 inline mr-1" />
          API Key (scripture.api.bible)
        </Label>
        <Input
          type="password"
          value={config.api_key || ""}
          onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
          placeholder="Enter your API key..."
          maxLength={512}
        />
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Get a free API key at scripture.api.bible. Your key is stored securely and never shown again.
        </p>
      </div>

      {/* Channel */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Verse Channel</Label>
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

      {/* Bible translation */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Bible Translation</Label>
        {bibles.length > 0 ? (
          <select
            value={config.bible_id}
            onChange={(e) => setConfig({ ...config, bible_id: e.target.value })}
            className="w-full rounded px-3 py-2 text-sm"
            style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
          >
            {bibles.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({b.abbreviation})</option>
            ))}
          </select>
        ) : (
          <div className="flex gap-2 items-center">
            <Input
              value={config.bible_id}
              onChange={(e) => setConfig({ ...config, bible_id: e.target.value })}
              placeholder="Bible ID (e.g. de4e12af7f28f599-02)"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={loadBibles} disabled={loadingBibles}>
              {loadingBibles ? "Loading..." : "Load Translations"}
            </Button>
          </div>
        )}
      </div>

      {/* Daily verse settings */}
      <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
        <div className="flex items-center gap-2">
          <Switch
            id="daily-verse"
            checked={config.daily_verse_enabled}
            onCheckedChange={(checked) => setConfig({ ...config, daily_verse_enabled: checked })}
          />
          <Label htmlFor="daily-verse" style={{ color: "var(--theme-text-normal)" }} className="text-sm">
            Daily Verse
          </Label>
        </div>

        {config.daily_verse_enabled && (
          <div className="flex gap-3">
            <div className="space-y-1.5">
              <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
                <Clock className="w-3 h-3 inline mr-1" />
                Time
              </Label>
              <Input
                type="time"
                value={config.daily_verse_time}
                onChange={(e) => setConfig({ ...config, daily_verse_time: e.target.value })}
                className="w-36"
              />
            </div>
            <div className="space-y-1.5">
              <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Timezone</Label>
              <select
                value={config.timezone}
                onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
                className="rounded px-3 py-2 text-sm"
                style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
              >
                {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Embed color */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Embed Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.embed_color}
            onChange={(e) => setConfig({ ...config, embed_color: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border-0"
          />
          <Input
            value={config.embed_color}
            onChange={(e) => setConfig({ ...config, embed_color: e.target.value })}
            placeholder="#C4A747"
            maxLength={7}
            className="w-28"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={saveConfig} disabled={saving} className="motion-interactive">
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? "Saving..." : "Save Configuration"}
        </Button>

        <Button variant="outline" onClick={postDailyVerse} disabled={posting}>
          <Send className="w-4 h-4 mr-1.5" />
          {posting ? "Posting..." : "Post Daily Verse Now"}
        </Button>
      </div>
    </div>
  )
}
