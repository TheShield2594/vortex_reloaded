"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Plus, Save, Clock, CheckCircle, Eye, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface Channel { id: string; name: string; type: string }

interface IncidentConfig {
  server_id: string
  channel_id: string | null
  severity_labels: string[]
  enabled: boolean
}

interface Incident {
  id: string
  title: string
  description: string | null
  severity: string
  status: "investigating" | "identified" | "monitoring" | "resolved"
  commander_id: string | null
  created_at: string
  resolved_at: string | null
  incident_updates: { count: number }[]
}

interface Props { serverId: string }

const STATUS_COLORS: Record<string, string> = {
  investigating: "#f04747",
  identified: "#faa61a",
  monitoring: "#5865f2",
  resolved: "#43b581",
}

export function IncidentAppConfig({ serverId }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [config, setConfig] = useState<IncidentConfig>({
    server_id: serverId,
    channel_id: null,
    severity_labels: ["SEV1 - Critical", "SEV2 - Major", "SEV3 - Minor", "SEV4 - Low"],
    enabled: true,
  })

  // Create incident form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newSeverity, setNewSeverity] = useState("")
  const [creating, setCreating] = useState(false)

  // Update form
  const [updateIncidentId, setUpdateIncidentId] = useState<string | null>(null)
  const [updateMessage, setUpdateMessage] = useState("")
  const [updateStatus, setUpdateStatus] = useState("")
  const [updating, setUpdating] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [incidentRes, channelsRes] = await Promise.all([
        fetch(`/api/servers/${serverId}/apps/incidents`),
        fetch(`/api/servers/${serverId}/channels`),
      ])

      if (incidentRes.ok) {
        const data = await incidentRes.json()
        if (data.config) {
          setConfig({
            ...data.config,
            severity_labels: Array.isArray(data.config.severity_labels) ? data.config.severity_labels : ["SEV1 - Critical", "SEV2 - Major", "SEV3 - Minor", "SEV4 - Low"],
          })
        }
        setIncidents(data.incidents ?? [])
      }

      if (channelsRes.ok) {
        const channelData = await channelsRes.json()
        setChannels((Array.isArray(channelData) ? channelData : []).filter((c: Channel) => c.type === "text"))
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load incident config" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [serverId])

  async function saveConfig() {
    setSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_config", ...config }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed")
      toast({ title: "Incident config saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSaving(false)
    }
  }

  async function createIncident() {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_incident",
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          severity: newSeverity || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      toast({ title: "Incident created" })
      setNewTitle("")
      setNewDescription("")
      setNewSeverity("")
      setShowCreateForm(false)
      await load()
    } catch (err) {
      toast({ variant: "destructive", title: "Create failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setCreating(false)
    }
  }

  async function postUpdate(incidentId: string, action: "update" | "resolve") {
    setUpdating(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/incidents/${incidentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          message: updateMessage.trim() || (action === "resolve" ? "Incident resolved" : undefined),
          status: action === "resolve" ? "resolved" : updateStatus || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      toast({ title: action === "resolve" ? "Incident resolved" : "Update posted" })
      setUpdateIncidentId(null)
      setUpdateMessage("")
      setUpdateStatus("")
      await load()
    } catch (err) {
      toast({ variant: "destructive", title: "Failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setUpdating(false)
    }
  }

  if (loading) return <p style={{ color: "var(--theme-text-muted)" }}>Loading incident config...</p>

  const activeIncidents = incidents.filter((i) => i.status !== "resolved")
  const resolvedIncidents = incidents.filter((i) => i.status === "resolved")

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          <AlertTriangle className="w-4 h-4 inline mr-1.5" />
          Incident Bot
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor="incident-enabled" style={{ color: "var(--theme-text-muted)" }} className="text-sm">Enabled</Label>
          <Switch id="incident-enabled" checked={config.enabled} onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })} />
        </div>
      </div>

      {/* Channel */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Incident Channel</Label>
        <select
          value={config.channel_id || ""}
          onChange={(e) => setConfig({ ...config, channel_id: e.target.value || null })}
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
        >
          <option value="">Select a channel...</option>
          {channels.map((ch) => <option key={ch.id} value={ch.id}># {ch.name}</option>)}
        </select>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Incident announcements and status updates will be posted here.
        </p>
      </div>

      {/* Severity Labels */}
      <div className="space-y-1.5">
        <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">
          Severity Levels
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {config.severity_labels.map((label, i) => (
            <span
              key={i}
              className="text-xs px-2 py-1 rounded"
              style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <Button onClick={saveConfig} disabled={saving} className="motion-interactive">
        <Save className="w-4 h-4 mr-1.5" />
        {saving ? "Saving..." : "Save Configuration"}
      </Button>

      {/* Create Incident */}
      <div className="border-t pt-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
        {!showCreateForm ? (
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="motion-interactive">
            <AlertTriangle className="w-4 h-4 mr-1.5" />
            Open Incident
          </Button>
        ) : (
          <div className="rounded border p-4 space-y-3" style={{ borderColor: "var(--theme-surface-elevated)", background: "var(--theme-bg-secondary)" }}>
            <p className="font-medium text-sm" style={{ color: "var(--theme-text-bright)" }}>New Incident</p>
            <div className="space-y-1.5">
              <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Title *</Label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Brief incident title" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Description</Label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="What's happening?" maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Severity</Label>
              <select
                value={newSeverity}
                onChange={(e) => setNewSeverity(e.target.value)}
                className="w-full rounded px-3 py-2 text-sm"
                style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
              >
                <option value="">Select severity...</option>
                {config.severity_labels.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button onClick={createIncident} disabled={creating || !newTitle.trim()} className="motion-interactive">
                {creating ? "Creating..." : "Open Incident"}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreateForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Active Incidents */}
      {activeIncidents.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
            Active Incidents ({activeIncidents.length})
          </p>
          {activeIncidents.map((inc) => {
            const updatesCount = inc.incident_updates?.[0]?.count ?? 0
            const isUpdating = updateIncidentId === inc.id
            return (
              <div key={inc.id} className="rounded border" style={{ borderColor: "var(--theme-surface-elevated)" }}>
                <div className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ background: STATUS_COLORS[inc.status] || "#999" }}
                        />
                        <p className="font-medium text-sm" style={{ color: "var(--theme-text-bright)" }}>
                          {inc.title}
                        </p>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
                        {inc.severity} · {inc.status} · {updatesCount} updates ·
                        <Clock className="w-3 h-3 inline ml-1 mr-0.5" />
                        {new Date(inc.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setUpdateIncidentId(isUpdating ? null : inc.id)} title="Post update">
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setUpdateIncidentId(inc.id); setUpdateMessage(""); postUpdate(inc.id, "resolve") }}
                        title="Resolve"
                      >
                        <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--theme-success, #43b581)" }} />
                      </Button>
                    </div>
                  </div>
                </div>
                {isUpdating && (
                  <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--theme-surface-elevated)" }}>
                    <Input
                      value={updateMessage}
                      onChange={(e) => setUpdateMessage(e.target.value)}
                      placeholder="Status update message..."
                      maxLength={2000}
                    />
                    <div className="flex gap-2 items-center">
                      <select
                        value={updateStatus}
                        onChange={(e) => setUpdateStatus(e.target.value)}
                        className="rounded px-2 py-1.5 text-sm"
                        style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-normal)", border: "1px solid var(--theme-surface-elevated)" }}
                      >
                        <option value="">Keep status</option>
                        <option value="investigating">Investigating</option>
                        <option value="identified">Identified</option>
                        <option value="monitoring">Monitoring</option>
                      </select>
                      <Button size="sm" onClick={() => postUpdate(inc.id, "update")} disabled={updating || !updateMessage.trim()}>
                        Post Update
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Resolved Incidents */}
      {resolvedIncidents.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
            Resolved ({resolvedIncidents.length})
          </p>
          {resolvedIncidents.slice(0, 10).map((inc) => (
            <div
              key={inc.id}
              className="rounded border p-3 flex items-center justify-between"
              style={{ borderColor: "var(--theme-surface-elevated)", opacity: 0.7 }}
            >
              <div>
                <p className="text-sm" style={{ color: "var(--theme-text-normal)" }}>
                  <CheckCircle className="w-3.5 h-3.5 inline mr-1" style={{ color: "var(--theme-success, #43b581)" }} />
                  {inc.title}
                </p>
                <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  {inc.severity} · Resolved {inc.resolved_at ? new Date(inc.resolved_at).toLocaleString() : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
