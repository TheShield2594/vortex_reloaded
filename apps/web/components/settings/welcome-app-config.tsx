"use client"

import { useEffect, useState } from "react"
import { Hash, Plus, Trash2, Save, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface Channel {
  id: string
  name: string
  type: string
}

interface WelcomeConfig {
  id?: string
  server_id: string
  channel_id: string | null
  welcome_message: string
  rules: string[]
  embed_color: string
  dm_on_join: boolean
  dm_message: string | null
  auto_role_ids: string[]
  enabled: boolean
}

interface Props {
  serverId: string
}

export function WelcomeAppConfig({ serverId }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [config, setConfig] = useState<WelcomeConfig>({
    server_id: serverId,
    channel_id: null,
    welcome_message: "Welcome to the server, {user}! We're glad to have you here.",
    rules: [],
    embed_color: "#5865F2",
    dm_on_join: false,
    dm_message: null,
    auto_role_ids: [],
    enabled: true,
  })
  const [newRule, setNewRule] = useState("")
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [configRes, channelsRes] = await Promise.all([
          fetch(`/api/servers/${serverId}/apps/welcome`),
          fetch(`/api/servers/${serverId}/channels`),
        ])

        if (configRes.ok) {
          const data = await configRes.json()
          if (data) {
            setConfig({
              ...data,
              rules: Array.isArray(data.rules) ? data.rules : [],
            })
          }
        }

        if (channelsRes.ok) {
          const channelData = await channelsRes.json()
          setChannels(
            (Array.isArray(channelData) ? channelData : []).filter(
              (c: Channel) => c.type === "text"
            )
          )
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load welcome config" })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [serverId])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/welcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Save failed")
      }
      const data = await res.json()
      setConfig({ ...data, rules: Array.isArray(data.rules) ? data.rules : [] })
      toast({ title: "Welcome config saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  function addRule() {
    const trimmed = newRule.trim()
    if (!trimmed) return
    if (config.rules.length >= 25) {
      toast({ variant: "destructive", title: "Max 25 rules allowed" })
      return
    }
    setConfig({ ...config, rules: [...config.rules, trimmed] })
    setNewRule("")
  }

  function removeRule(index: number) {
    setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })
  }

  const previewMessage = config.welcome_message.replace(/{user}/g, "NewMember")

  if (loading) {
    return <p style={{ color: "var(--theme-text-muted)" }}>Loading welcome config...</p>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          Welcome Bot Configuration
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor="welcome-enabled" style={{ color: "var(--theme-text-muted)" }} className="text-sm">
            Enabled
          </Label>
          <Switch
            id="welcome-enabled"
            checked={config.enabled}
            onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
          />
        </div>
      </div>

      {/* Welcome Channel */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Welcome Channel</Label>
        <select
          value={config.channel_id || ""}
          onChange={(e) => setConfig({ ...config, channel_id: e.target.value || null })}
          className="w-full rounded px-3 py-2 text-sm"
          style={{
            background: "var(--theme-bg-primary)",
            color: "var(--theme-text-normal)",
            border: "1px solid var(--theme-surface-elevated)",
          }}
        >
          <option value="">Select a channel...</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              # {ch.name}
            </option>
          ))}
        </select>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          New member welcome messages will be posted in this channel.
        </p>
      </div>

      {/* Welcome Message */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
          Welcome Message
        </Label>
        <textarea
          value={config.welcome_message}
          onChange={(e) => setConfig({ ...config, welcome_message: e.target.value })}
          maxLength={2000}
          rows={3}
          className="w-full rounded px-3 py-2 text-sm resize-y"
          style={{
            background: "var(--theme-bg-primary)",
            color: "var(--theme-text-normal)",
            border: "1px solid var(--theme-surface-elevated)",
          }}
          placeholder="Welcome to the server, {user}!"
        />
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Use <code style={{ color: "var(--theme-accent)" }}>{"{user}"}</code> to mention the new member.
        </p>
      </div>

      {/* Preview */}
      <button
        onClick={() => setShowPreview(!showPreview)}
        className="flex items-center gap-1.5 text-xs"
        style={{ color: "var(--theme-accent)" }}
      >
        <Eye className="w-3.5 h-3.5" />
        {showPreview ? "Hide preview" : "Show preview"}
      </button>
      {showPreview && (
        <div
          className="rounded p-3 text-sm"
          style={{
            background: "var(--theme-bg-primary)",
            borderLeft: `3px solid ${config.embed_color}`,
            color: "var(--theme-text-normal)",
          }}
        >
          {previewMessage}
          {config.rules.length > 0 && (
            <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--theme-surface-elevated)" }}>
              <p className="font-semibold text-xs mb-1" style={{ color: "var(--theme-text-bright)" }}>Server Rules</p>
              <ol className="list-decimal list-inside text-xs space-y-0.5" style={{ color: "var(--theme-text-muted)" }}>
                {config.rules.map((rule, i) => (
                  <li key={i}>{rule}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Embed Color */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Embed Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.embed_color}
            onChange={(e) => setConfig({ ...config, embed_color: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
          />
          <Input
            value={config.embed_color}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                setConfig({ ...config, embed_color: e.target.value })
              }
            }}
            className="w-28"
            maxLength={7}
          />
        </div>
      </div>

      {/* Server Rules */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
          Server Rules ({config.rules.length}/25)
        </Label>
        <div className="space-y-1.5">
          {config.rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs w-5 text-right flex-shrink-0" style={{ color: "var(--theme-text-muted)" }}>
                {i + 1}.
              </span>
              <span
                className="flex-1 text-sm rounded px-2 py-1"
                style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)" }}
              >
                {rule}
              </span>
              <button onClick={() => removeRule(i)} className="flex-shrink-0" aria-label={`Remove rule ${i + 1}`}>
                <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--theme-danger, #f04747)" }} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule() } }}
            placeholder="Add a rule..."
            className="flex-1"
          />
          <Button size="sm" onClick={addRule} disabled={!newRule.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* DM on Join */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Switch
            id="dm-on-join"
            checked={config.dm_on_join}
            onCheckedChange={(checked) => setConfig({ ...config, dm_on_join: checked })}
          />
          <Label htmlFor="dm-on-join" style={{ color: "var(--theme-text-muted)" }} className="text-sm">
            Send DM to new members
          </Label>
        </div>
        {config.dm_on_join && (
          <textarea
            value={config.dm_message || ""}
            onChange={(e) => setConfig({ ...config, dm_message: e.target.value || null })}
            rows={2}
            maxLength={2000}
            className="w-full rounded px-3 py-2 text-sm resize-y"
            style={{
              background: "var(--theme-bg-primary)",
              color: "var(--theme-text-normal)",
              border: "1px solid var(--theme-surface-elevated)",
            }}
            placeholder="Welcome! Here are some things to know..."
          />
        )}
      </div>

      {/* Save */}
      <Button onClick={save} disabled={saving} className="motion-interactive">
        <Save className="w-4 h-4 mr-1.5" />
        {saving ? "Saving..." : "Save Configuration"}
      </Button>
    </div>
  )
}
