"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { DialogTitle, DialogDescription } from "@/components/ui/dialog"
import type { ServerRow } from "@/types/database"

interface Props {
  serverId?: string
  createName?: string
  createDescription?: string
  iconUrl?: string
  onServerCreated?: (server: ServerRow) => void
}

export function TemplateManager({ serverId, createName, createDescription, iconUrl, onServerCreated }: Props) {
  const { toast } = useToast()
  const [starterTemplates, setStarterTemplates] = useState<Record<string, unknown>>({})
  const [starterKey, setStarterKey] = useState("")
  const [rawTemplate, setRawTemplate] = useState("")
  const [warnings, setWarnings] = useState<string[]>([])
  const [diff, setDiff] = useState<{ roles: { current: number; incoming: number }; categories: { current: number; incoming: number }; channels: { current: number; incoming: number } } | null>(null)
  const [loading, setLoading] = useState(false)
  const [exportValue, setExportValue] = useState("")

  useEffect(() => {
    fetch("/api/server-templates?mode=starter")
      .then((r) => r.json())
      .then((d) => setStarterTemplates(d.templates ?? {}))
      .catch(() => setStarterTemplates({}))
  }, [])

  const parsedTemplate = useMemo(() => {
    if (starterKey && starterTemplates[starterKey]) return starterTemplates[starterKey]
    if (!rawTemplate.trim()) return null
    try {
      return JSON.parse(rawTemplate)
    } catch {
      return null
    }
  }, [rawTemplate, starterKey, starterTemplates])

  async function request(mode: string) {
    if (!parsedTemplate && mode !== "export") {
      toast({ variant: "destructive", title: "Provide a valid blueprint JSON or starter blueprint" })
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/server-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          serverId,
          name: createName,
          description: createDescription,
          iconUrl,
          template: parsedTemplate,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? data.errors?.join(", ") ?? "Request failed")
      setWarnings(data.warnings ?? [])
      if (mode === "preview") setDiff(data.diff)
      if (mode === "apply") toast({ title: "Blueprint imported successfully" })
      if (mode === "create-server") {
        toast({ title: "Server created from blueprint" })
        onServerCreated?.(data.server)
      }
      if (mode === "export") {
        setExportValue(JSON.stringify(data.template, null, 2))
        toast({ title: "Blueprint exported" })
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Blueprint request failed", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <DialogTitle className="sr-only">Server Template Manager</DialogTitle>
      <DialogDescription className="sr-only">Manage server templates</DialogDescription>
      <div className="space-y-1">
        <Label className="text-xs uppercase" style={{ color: 'var(--theme-text-secondary)' }}>Starter blueprint</Label>
        <select
          value={starterKey}
          onChange={(e) => setStarterKey(e.target.value)}
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-bg-tertiary)' }}
        >
          <option value="">Custom JSON</option>
          {Object.keys(starterTemplates).map((key) => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs uppercase" style={{ color: 'var(--theme-text-secondary)' }}>Blueprint JSON</Label>
        <textarea
          value={rawTemplate}
          onChange={(e) => { setRawTemplate(e.target.value); setStarterKey("") }}
          rows={8}
          placeholder='{"metadata":{"source":"custom","version":"1.0.0","created_by":"you"},"roles":[],"categories":[],"channels":[]}'
          className="w-full rounded px-3 py-2 text-xs font-mono resize-y"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-bg-tertiary)' }}
        />
      </div>

      <div className="flex gap-2">
        {serverId && <Button variant="outline" onClick={() => request("preview")} disabled={loading}>Preview Diff</Button>}
        {serverId && <Button onClick={() => request("apply")} disabled={loading} style={{ background: 'var(--theme-accent)' }}>Import Blueprint</Button>}
        {!serverId && <Button onClick={() => request("create-server")} disabled={loading || !createName?.trim()} style={{ background: 'var(--theme-accent)' }}>Create from Blueprint</Button>}
        {serverId && <Button variant="outline" onClick={() => request("export")} disabled={loading}>Export</Button>}
      </div>

      {diff && (
        <div className="text-xs rounded p-2" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-secondary)' }}>
          <div>Roles: {diff.roles.current} → {diff.roles.incoming}</div>
          <div>Categories: {diff.categories.current} → {diff.categories.incoming}</div>
          <div>Channels: {diff.channels.current} → {diff.channels.incoming}</div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="text-xs rounded p-2" style={{ background: 'color-mix(in srgb, var(--theme-warning) 15%, transparent)', color: 'var(--theme-warning)' }}>
          {warnings.slice(0, 6).map((warning) => <div key={warning}>• {warning}</div>)}
        </div>
      )}

      {exportValue && (
        <div className="space-y-1">
          <Label className="text-xs uppercase" style={{ color: 'var(--theme-text-secondary)' }}>Exported blueprint</Label>
          <textarea readOnly value={exportValue} rows={8} className="w-full rounded px-3 py-2 text-xs font-mono" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-bg-tertiary)' }} />
        </div>
      )}
    </div>
  )
}
