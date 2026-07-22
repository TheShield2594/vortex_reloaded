"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ChevronDown, ChevronRight, Download, Filter, Loader2, ShieldAlert, User } from "lucide-react"
import { buildDiffRows, type TimelineActionType } from "@/lib/mod-ledger"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type EventActor = { id: string; username: string; display_name: string | null; avatar_url: string | null }
type TimelineEvent = {
  id: string
  action: string
  action_type: TimelineActionType
  created_at: string
  reason: string | null
  actor_id: string | null
  target_id: string | null
  target_type: string | null
  metadata: Record<string, unknown> | null
  actor: EventActor | null
  target: EventActor | null
  incident_key: string
}

type TimelinePayload = {
  data: TimelineEvent[]
  incidents: Array<{ incident_key: string; count: number; started_at: string | null; latest_at: string | null; events: TimelineEvent[] }>
  next_cursor: string | null
}

const ACTION_TYPE_OPTIONS: TimelineActionType[] = ["ban", "kick", "timeout", "message_action", "automod", "appeal", "role_change", "settings", "other"]

export function ModLedger({ serverId }: { serverId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [incidents, setIncidents] = useState<TimelinePayload["incidents"]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandedIncidents, setExpandedIncidents] = useState<Record<string, boolean>>({})

  const [actorId, setActorId] = useState("")
  const [targetId, setTargetId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [actionTypes, setActionTypes] = useState<TimelineActionType[]>([])

  const params = useMemo(() => {
    const search = new URLSearchParams({ limit: "50" })
    if (actorId) search.set("actor_id", actorId)
    if (targetId) search.set("target_id", targetId)
    if (from) search.set("from", new Date(from).toISOString())
    if (to) search.set("to", new Date(to).toISOString())
    if (actionTypes.length) search.set("action_types", actionTypes.join(","))
    return search
  }, [actionTypes, actorId, from, targetId, to])

  const load = useCallback(async (append = false) => {
    setLoading(true)
    const search = new URLSearchParams(params)
    if (append && cursor) search.set("cursor", cursor)

    const res = await fetch(`/api/servers/${serverId}/moderation/timeline?${search.toString()}`)
    if (!res.ok) {
      setLoading(false)
      return
    }

    const payload = (await res.json()) as TimelinePayload
    setEvents((prev) => (append ? [...prev, ...payload.data] : payload.data))
    setIncidents((prev) => (append ? [...prev, ...payload.incidents] : payload.incidents))
    setCursor(payload.next_cursor)
    setLoading(false)
  }, [cursor, params, serverId])

  useEffect(() => {
    void load(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onToggleActionType = (actionType: TimelineActionType) => {
    setActionTypes((prev) => (prev.includes(actionType) ? prev.filter((item) => item !== actionType) : [...prev, actionType]))
  }

  const exportFile = async (formatType: "json" | "csv") => {
    const search = new URLSearchParams(params)
    search.set("limit", "200")
    search.set("format", formatType)
    const res = await fetch(`/api/servers/${serverId}/moderation/timeline?${search.toString()}`)
    if (!res.ok) return

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `mod-ledger.${formatType}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="p-6 text-zinc-100 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Mod Ledger</h1>
          <p className="text-sm text-zinc-400">Unified ledger across bans, kicks, timeouts, automod, appeals, messages, and role changes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => exportFile("json")}><Download className="w-4 h-4 mr-1" />Export JSON</Button>
          <Button variant="outline" onClick={() => exportFile("csv")}><Download className="w-4 h-4 mr-1" />Export CSV</Button>
        </div>
      </header>

      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-zinc-300"><Filter className="w-4 h-4" /> Filters</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input placeholder="Actor user id" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          <Input placeholder="Target user id" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTION_TYPE_OPTIONS.map((actionType) => (
            <Button key={actionType} size="sm" variant={actionTypes.includes(actionType) ? "default" : "outline"} onClick={() => onToggleActionType(actionType)}>
              {actionType}
            </Button>
          ))}
        </div>
        <Button onClick={() => load(false)} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply filters"}</Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h2 className="font-semibold">Timeline Events</h2>
          {events.map((event) => {
            const key = `event-${event.id}`
            const isOpen = !!expanded[key]
            const diffRows = buildDiffRows(event.metadata)
            const actorName = event.actor?.display_name ?? event.actor?.username ?? event.actor_id ?? "system"
            const targetName = event.target?.display_name ?? event.target?.username ?? event.target_id ?? "n/a"

            return (
              <article key={event.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                <button className="w-full text-left flex items-start justify-between gap-2" onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{event.action} · {event.action_type}</p>
                    <p className="text-xs text-zinc-400 truncate">{actorName} → {targetName}</p>
                  </div>
                  <span className="text-xs text-zinc-500 flex items-center gap-1">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{format(new Date(event.created_at), "MMM d, HH:mm")}</span>
                </button>
                {isOpen && (
                  <div className="mt-3 text-sm space-y-2">
                    {event.reason && <p className="text-zinc-300">Reason: {event.reason}</p>}
                    <p className="text-zinc-400">Incident: {event.incident_key}</p>
                    {diffRows.length > 0 && (
                      <div className="rounded bg-zinc-950 p-2 border border-zinc-800">
                        <p className="text-xs text-zinc-400 mb-1">Before / After</p>
                        {diffRows.map((row) => (
                          <div key={`${event.id}-${row.field}`} className="grid grid-cols-3 gap-2 text-xs py-0.5">
                            <span className="text-zinc-400">{row.field}</span>
                            <span className="text-red-300 break-all">{JSON.stringify(row.before)}</span>
                            <span className="text-green-300 break-all">{JSON.stringify(row.after)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
          <Button onClick={() => load(true)} disabled={!cursor || loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more"}</Button>
        </div>

        <div className="space-y-3">
          <h2 className="font-semibold">Incident View</h2>
          {incidents.map((incident) => {
            const open = !!expandedIncidents[incident.incident_key]
            return (
              <article key={incident.incident_key} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                <button className="w-full text-left flex items-center justify-between" onClick={() => setExpandedIncidents((prev) => ({ ...prev, [incident.incident_key]: !open }))}>
                  <div>
                    <p className="text-sm font-medium truncate">{incident.incident_key}</p>
                    <p className="text-xs text-zinc-400">{incident.count} events</p>
                  </div>
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {open && (
                  <ul className="mt-2 space-y-2">
                    {incident.events.map((event) => (
                      <li key={event.id} className="text-xs text-zinc-300 flex items-center gap-2">
                        <ShieldAlert className="w-3 h-3" />
                        <span>{event.action}</span>
                        <span className="text-zinc-500">{format(new Date(event.created_at), "MMM d, HH:mm")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )
          })}
          {incidents.length === 0 && <p className="text-sm text-zinc-500 flex items-center gap-2"><User className="w-4 h-4" />No incidents loaded yet.</p>}
        </div>
      </div>
    </section>
  )
}
