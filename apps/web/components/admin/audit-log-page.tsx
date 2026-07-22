"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import {
  Activity,
  Ban,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  Hash,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Webhook,
  X,
  Zap,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserInfo {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface AuditEntry {
  id: string
  action: string
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  actor: UserInfo | null
  target: UserInfo | null
  target_id: string | null
  target_type: string | null
}

interface AuditPayload {
  entries: AuditEntry[]
  next_before: string | null
}

// ---------------------------------------------------------------------------
// Action metadata
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  // Members
  member_join: "Member Joined",
  member_leave: "Member Left",
  member_kick: "Member Kicked",
  member_ban: "Member Banned",
  member_unban: "Member Unbanned",
  member_timeout: "Member Timed Out",
  member_timeout_remove: "Timeout Removed",
  // Roles
  role_created: "Role Created",
  role_updated: "Role Updated",
  role_deleted: "Role Deleted",
  role_assigned: "Role Assigned",
  role_removed: "Role Removed",
  // Channels
  channel_created: "Channel Created",
  channel_deleted: "Channel Deleted",
  channel_updated: "Channel Updated",
  channel_permissions_updated: "Channel Perms Updated",
  channel_permissions_deleted: "Channel Perms Removed",
  // Messages
  message_deleted: "Message Deleted",
  message_pinned: "Message Pinned",
  // Webhooks & Invites
  webhook_created: "Webhook Created",
  webhook_deleted: "Webhook Deleted",
  invite_created: "Invite Created",
  // Server
  server_settings_updated: "Server Settings Changed",
  moderation_settings_updated: "Moderation Settings Updated",
  // AutoMod
  automod_rule_created: "AutoMod Rule Created",
  automod_rule_updated: "AutoMod Rule Updated",
  automod_rule_deleted: "AutoMod Rule Deleted",
  // Appeals
  appeal_status_changed: "Appeal Updated",
}

type Category =
  | "member"
  | "role"
  | "channel"
  | "message"
  | "server"
  | "automod"
  | "other"

const ACTION_CATEGORY: Record<string, Category> = {
  member_join: "member",
  member_leave: "member",
  member_kick: "member",
  member_ban: "member",
  member_unban: "member",
  member_timeout: "member",
  member_timeout_remove: "member",
  role_created: "role",
  role_updated: "role",
  role_deleted: "role",
  role_assigned: "role",
  role_removed: "role",
  channel_created: "channel",
  channel_deleted: "channel",
  channel_updated: "channel",
  channel_permissions_updated: "channel",
  channel_permissions_deleted: "channel",
  message_deleted: "message",
  message_pinned: "message",
  webhook_created: "server",
  webhook_deleted: "server",
  invite_created: "server",
  server_settings_updated: "server",
  moderation_settings_updated: "server",
  automod_rule_created: "automod",
  automod_rule_updated: "automod",
  automod_rule_deleted: "automod",
  appeal_status_changed: "other",
}

const CATEGORY_STYLES: Record<Category, { label: string; cssVar: string }> = {
  member: { label: "Members", cssVar: "--theme-cat-member" },
  role: { label: "Roles", cssVar: "--theme-cat-role" },
  channel: { label: "Channels", cssVar: "--theme-cat-channel" },
  message: { label: "Messages", cssVar: "--theme-cat-message" },
  server: { label: "Server", cssVar: "--theme-cat-server" },
  automod: { label: "AutoMod", cssVar: "--theme-cat-automod" },
  other: { label: "Other", cssVar: "--theme-cat-other" },
}

function actionIconCssVar(action: string): string {
  const category = ACTION_CATEGORY[action] ?? "other"
  return CATEGORY_STYLES[category].cssVar
}

function actionIcon(action: string) {
  const size = "w-4 h-4"
  const color = `var(${actionIconCssVar(action)})`
  const Icon = (() => {
    if (action === "member_join") return UserPlus
    if (action === "member_leave") return UserMinus
    if (action === "member_kick") return UserX
    if (action === "member_ban") return Ban
    if (action === "member_unban") return Shield
    if (action.startsWith("member_timeout")) return UserCheck
    if (action.startsWith("role_")) return ShieldAlert
    if (action.startsWith("channel_")) return Hash
    if (action.startsWith("message_")) return MessageSquare
    if (action.startsWith("webhook_")) return Webhook
    if (action === "invite_created") return UserPlus
    if (action.startsWith("automod_")) return Zap
    if (action.startsWith("server_") || action.startsWith("moderation_")) return Mic
    return Activity
  })()
  return <Icon className={size} style={{ color }} />
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userName(u: UserInfo | null): string {
  if (!u) return "Unknown"
  return u.display_name ?? u.username
}

function formatTimestamp(ts: string): string {
  return format(new Date(ts), "MMM d, yyyy HH:mm:ss")
}

function buildSummary(entry: AuditEntry): string {
  const actor = userName(entry.actor)
  const target = userName(entry.target) || entry.target_id || "—"
  const label = ACTION_LABELS[entry.action] ?? entry.action
  const meta = entry.metadata as Record<string, unknown> | null

  switch (entry.action) {
    case "member_join":
    case "member_leave":
      return `${target} ${label.toLowerCase()}`
    case "member_kick":
      return `${actor} kicked ${target}`
    case "member_ban":
      return `${actor} banned ${target}${meta?.duration ? ` for ${meta.duration}` : ""}`
    case "member_unban":
      return `${actor} unbanned ${target}`
    case "member_timeout":
      return `${actor} timed out ${target}${meta?.duration ? ` for ${meta.duration}` : ""}`
    case "member_timeout_remove":
      return `${actor} removed timeout from ${target}`
    case "role_created":
      return `${actor} created role "${meta?.name ?? target}"`
    case "role_updated":
      return `${actor} updated role "${meta?.name ?? target}"`
    case "role_deleted":
      return `${actor} deleted role "${meta?.name ?? target}"`
    case "role_assigned":
      return `${actor} assigned role to ${target}`
    case "role_removed":
      return `${actor} removed role from ${target}`
    case "channel_created":
      return `${actor} created channel #${meta?.name ?? target} (${meta?.type ?? "text"})`
    case "channel_deleted":
      return `${actor} deleted channel #${meta?.name ?? target}`
    case "channel_updated":
      return `${actor} updated channel #${meta?.name ?? target}`
    case "message_deleted":
      return `${actor} deleted a message`
    case "message_pinned":
      return `${actor} pinned a message`
    case "webhook_created":
      return `${actor} created webhook "${meta?.name ?? ""}"`
    case "webhook_deleted":
      return `${actor} deleted webhook "${meta?.name ?? ""}"`
    case "invite_created":
      return `${actor} created invite ${meta?.code ?? ""}`
    case "server_settings_updated":
      return `${actor} changed server settings`
    case "moderation_settings_updated":
      return `${actor} updated moderation settings`
    case "automod_rule_created":
      return `${actor} created AutoMod rule "${meta?.name ?? ""}"`
    case "automod_rule_updated":
      return `${actor} updated AutoMod rule "${meta?.name ?? ""}"`
    case "automod_rule_deleted":
      return `${actor} deleted AutoMod rule "${meta?.name ?? ""}"`
    default:
      return `${actor} → ${target}`
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetadataDiff({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null
  const before = metadata.before as Record<string, unknown> | null
  const after = metadata.after as Record<string, unknown> | null
  if (!before && !after) return null

  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
  const changed = keys.filter((k) => JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k]))
  if (changed.length === 0) return null

  return (
    <div className="rounded bg-zinc-950 border border-zinc-800 p-2 text-xs mt-2 space-y-1">
      <p className="text-zinc-500 font-medium">Changes</p>
      {changed.map((key) => (
        <div key={key} className="grid grid-cols-[7rem_1fr_1fr] gap-2">
          <span className="text-zinc-400 truncate">{key}</span>
          <span className="text-red-300 break-all">{JSON.stringify((before ?? {})[key]) ?? "—"}</span>
          <span className="text-green-300 break-all">{JSON.stringify((after ?? {})[key]) ?? "—"}</span>
        </div>
      ))}
    </div>
  )
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const category = ACTION_CATEGORY[entry.action] ?? "other"
  const catStyle = CATEGORY_STYLES[category]

  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-900/40">
      <button
        className="w-full text-left flex items-start gap-3 p-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-shrink-0 mt-0.5">{actionIcon(entry.action)}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: `var(${catStyle.cssVar})` }}>
              {ACTION_LABELS[entry.action] ?? entry.action}
            </span>
            <span
              className="text-xs border rounded px-1.5 py-0.5"
              style={{
                color: `var(${catStyle.cssVar})`,
                borderColor: `color-mix(in srgb, var(${catStyle.cssVar}) 40%, transparent)`,
                background: `color-mix(in srgb, var(${catStyle.cssVar}) 12%, transparent)`,
              }}
            >
              {catStyle.label}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{buildSummary(entry)}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.actor?.avatar_url && (
            <Avatar className="w-5 h-5">
              <AvatarImage src={entry.actor.avatar_url} />
              <AvatarFallback className="text-[9px]">
                {(entry.actor.display_name ?? entry.actor.username).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            {format(new Date(entry.created_at), "MMM d, HH:mm")}
          </span>
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 text-sm space-y-2 border-t border-zinc-800 pt-2">
          {entry.reason && (
            <p className="text-zinc-300">
              <span className="text-zinc-500">Reason: </span>{entry.reason}
            </p>
          )}

          <div className="text-xs text-zinc-500 space-y-0.5">
            <p>Timestamp: {formatTimestamp(entry.created_at)}</p>
            <p>Event ID: <span className="font-mono">{entry.id}</span></p>
            {entry.actor && (
              <p>
                Actor: {userName(entry.actor)}
                <span className="font-mono ml-1 text-zinc-600">({entry.actor.id})</span>
              </p>
            )}
            {entry.target && (
              <p>
                Target: {userName(entry.target)}
                <span className="font-mono ml-1 text-zinc-600">({entry.target.id})</span>
              </p>
            )}
            {entry.target_id && !entry.target && (
              <p>
                Target: <span className="font-mono">{entry.target_id}</span>
                {" "}({entry.target_type})
              </p>
            )}
          </div>

          <MetadataDiff metadata={entry.metadata} />
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50
const CATEGORIES = Object.keys(CATEGORY_STYLES) as Category[]
const ALL_ACTIONS = Object.keys(ACTION_LABELS)

export function AuditLogPage({ serverId }: { serverId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Filter state
  const [actorSearch, setActorSearch] = useState("")
  const [selectedAction, setSelectedAction] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<Category | "">("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const activeActions = useMemo(() => {
    if (selectedAction) return [selectedAction]
    if (selectedCategory) return ALL_ACTIONS.filter((a) => ACTION_CATEGORY[a] === selectedCategory)
    return []
  }, [selectedAction, selectedCategory])

  function buildParams(before?: string, forExport = false) {
    const p = new URLSearchParams()
    p.set("limit", forExport ? "5000" : String(PAGE_SIZE))
    if (before) p.set("before", before)
    if (actorSearch.trim()) p.set("actor_id", actorSearch.trim())
    if (activeActions.length === 1) p.set("action", activeActions[0]!)
    if (from) p.set("from", new Date(from).toISOString())
    if (to) p.set("to", new Date(to).toISOString())
    return p
  }

  const load = useCallback(
    async (append = false) => {
      setLoading(true)
      const before = append ? (nextBefore ?? undefined) : undefined
      const res = await fetch(
        `/api/servers/${serverId}/audit-log?${buildParams(before).toString()}`
      )
      if (res.ok) {
        const payload = (await res.json()) as AuditPayload
        setEntries((prev) => (append ? [...prev, ...payload.entries] : payload.entries))
        setNextBefore(payload.next_before)
      }
      setLoading(false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId, actorSearch, activeActions, from, to, nextBefore]
  )

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyFilters() {
    setNextBefore(null)
    void load(false)
  }

  function clearFilters() {
    setActorSearch("")
    setSelectedAction("")
    setSelectedCategory("")
    setFrom("")
    setTo("")
  }

  async function handleExport(fmt: "json" | "csv") {
    setExporting(true)
    const p = buildParams(undefined, true)
    p.set("format", fmt)
    const res = await fetch(`/api/servers/${serverId}/audit-log?${p.toString()}`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `audit-log-${serverId}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    }
    setExporting(false)
  }

  const hasActiveFilters =
    actorSearch.trim() || selectedAction || selectedCategory || from || to

  return (
    <section className="space-y-4 text-zinc-100">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Audit Log
          </h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Server event history in reverse chronological order. Retained for 180 days.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="text-xs"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleExport("json")}
            disabled={exporting}
            className="text-xs"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            JSON
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <p className="text-sm text-zinc-300 flex items-center gap-1.5">
          <Filter className="w-4 h-4" /> Filters
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          <Input
            placeholder="Filter by user (ID or @username)"
            value={actorSearch}
            onChange={(e) => setActorSearch(e.target.value)}
          />
          <select
            className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            value={selectedAction}
            onChange={(e) => {
              setSelectedAction(e.target.value)
              setSelectedCategory("")
            }}
          >
            <option value="">All action types</option>
            {ALL_ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
            ))}
          </select>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From date"
            title="From date"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To date"
            title="To date"
          />
        </div>

        {/* Category quick-filters */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => {
            const style = CATEGORY_STYLES[cat]
            return (
              <Button
                key={cat}
                size="sm"
                variant={selectedCategory === cat ? "default" : "outline"}
                onClick={() => {
                  setSelectedCategory((prev) => (prev === cat ? "" : cat))
                  setSelectedAction("")
                }}
                className="capitalize text-xs"
                style={selectedCategory === cat ? undefined : { color: `var(${style.cssVar})` }}
              >
                {style.label}
              </Button>
            )
          })}
          {hasActiveFilters && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearFilters}
              className="text-zinc-400 text-xs"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>

        <Button onClick={applyFilters} disabled={loading} size="sm">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Apply Filters
        </Button>
      </div>

      {/* Entry list */}
      <div className="space-y-2">
        {loading && entries.length === 0 && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-10 text-zinc-500">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No audit log entries found.</p>
          </div>
        )}

        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}

        {/* Load more / pagination */}
        <Button
          onClick={() => load(true)}
          disabled={!nextBefore || loading}
          variant="outline"
          size="sm"
          className="w-full"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin mr-1" />
            : null}
          {nextBefore ? `Load more (${PAGE_SIZE} per page)` : "No more entries"}
        </Button>
      </div>
    </section>
  )
}
