"use client"

import { useEffect, useState } from "react"
import { Rss, Save, Trash2, Plus, RefreshCw, Link } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface Channel { id: string; name: string; type: string }

interface RssConfig {
  server_id: string
  channel_id: string | null
  max_feeds: number
  enabled: boolean
}

interface RssFeed {
  id: string
  server_id: string
  channel_id: string | null
  feed_url: string
  feed_title: string | null
  last_fetched_at: string | null
  created_at: string
}

interface Props { serverId: string }

export function RssFeedAppConfig({ serverId }: Props): React.ReactElement {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [feeds, setFeeds] = useState<RssFeed[]>([])
  const [config, setConfig] = useState<RssConfig>({
    server_id: serverId,
    channel_id: null,
    max_feeds: 10,
    enabled: true,
  })
  const [newUrl, setNewUrl] = useState("")
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true)
      try {
        const [rssRes, channelsRes] = await Promise.all([
          fetch(`/api/servers/${serverId}/apps/rss-feed`),
          fetch(`/api/servers/${serverId}/channels`),
        ])

        if (rssRes.ok) {
          const data = await rssRes.json()
          if (data.config) setConfig(data.config)
          setFeeds(data.feeds ?? [])
        }

        if (channelsRes.ok) {
          const channelData = await channelsRes.json()
          setChannels((Array.isArray(channelData) ? channelData : []).filter((c: Channel) => c.type === "text"))
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load RSS feed config" })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serverId])

  async function saveConfig(): Promise<void> {
    setSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/rss-feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_config", ...config }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed")
      toast({ title: "RSS Feed config saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  async function addFeed(): Promise<void> {
    const url = newUrl.trim()
    if (!url) {
      toast({ variant: "destructive", title: "URL required" })
      return
    }

    setAdding(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/rss-feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_feed", feed_url: url }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Add failed")
      toast({ title: "Feed added!" })
      setNewUrl("")
      // Refresh
      const refreshRes = await fetch(`/api/servers/${serverId}/apps/rss-feed`)
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        setFeeds(data.feeds ?? [])
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to add feed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setAdding(false)
    }
  }

  async function removeFeed(feedId: string): Promise<void> {
    setDeletingId(feedId)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/rss-feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_feed", feed_id: feedId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Remove failed")
      setFeeds(feeds.filter((f) => f.id !== feedId))
      toast({ title: "Feed removed" })
    } catch (err) {
      toast({ variant: "destructive", title: "Remove failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setDeletingId(null)
    }
  }

  async function fetchFeeds(): Promise<void> {
    setFetching(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/rss-feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch_feeds" }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Fetch failed")
      const data = await res.json()
      toast({ title: `Fetched feeds`, description: `${data.posted ?? 0} new posts published` })
    } catch (err) {
      toast({ variant: "destructive", title: "Fetch failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setFetching(false)
    }
  }

  if (loading) return <p style={{ color: "var(--theme-text-muted)" }}>Loading RSS feed config...</p>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          <Rss className="w-4 h-4 inline mr-1.5" />
          RSS Feed Bot
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor="rss-enabled" style={{ color: "var(--theme-text-muted)" }} className="text-sm">Enabled</Label>
          <Switch id="rss-enabled" checked={config.enabled} onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })} />
        </div>
      </div>

      {/* Default Channel */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Default Feed Channel</Label>
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

      {/* Max feeds per server */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Max Feeds Per Server</Label>
        <Input
          type="number"
          min={1}
          max={25}
          value={config.max_feeds}
          onChange={(e) => setConfig({ ...config, max_feeds: Math.min(25, Math.max(1, parseInt(e.target.value) || 1)) })}
          className="w-32"
        />
      </div>

      <Button onClick={saveConfig} disabled={saving} className="motion-interactive">
        <Save className="w-4 h-4 mr-1.5" />
        {saving ? "Saving..." : "Save Configuration"}
      </Button>

      {/* Add feed */}
      <div className="border-t pt-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
        <p className="text-sm font-medium mb-3" style={{ color: "var(--theme-text-bright)" }}>
          <Plus className="w-3.5 h-3.5 inline mr-1" />
          Add RSS Feed
        </p>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeed() } }}
              placeholder="https://blog.example.com/rss"
              maxLength={2048}
              className="flex-1"
            />
            <Button size="sm" onClick={addFeed} disabled={adding || !newUrl.trim()}>
              {adding ? "Adding..." : "Add Feed"}
            </Button>
          </div>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            <Link className="w-3 h-3 inline mr-1" />
            Paste an RSS or Atom feed URL. The bot will auto-detect the feed title.
          </p>
        </div>
      </div>

      {/* Fetch now button */}
      {feeds.length > 0 && (
        <Button variant="outline" size="sm" onClick={fetchFeeds} disabled={fetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${fetching ? "animate-spin" : ""}`} />
          {fetching ? "Fetching..." : "Fetch Now"}
        </Button>
      )}

      {/* Feed list */}
      {feeds.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
            <Rss className="w-3.5 h-3.5 inline mr-1" />
            Subscribed Feeds ({feeds.length})
          </p>
          {feeds.map((feed) => (
            <div key={feed.id} className="rounded border p-3 flex items-center justify-between" style={{ borderColor: "var(--theme-surface-elevated)" }}>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate" style={{ color: "var(--theme-text-normal)" }}>
                  {feed.feed_title || feed.feed_url}
                </p>
                <p className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>
                  {feed.feed_url}
                </p>
                {feed.last_fetched_at && (
                  <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                    Last fetched: {new Date(feed.last_fetched_at).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={deletingId === feed.id}
                onClick={() => removeFeed(feed.id)}
                aria-label="Remove feed"
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
