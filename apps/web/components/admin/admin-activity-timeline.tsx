"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ChevronDown, ChevronRight, Filter, History, Loader2, MinusCircle, PlusCircle, UserCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ---------------------------------------------------------------------------
// Types mirroring the API response
// ---------------------------------------------------------------------------

interface UserInfo {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface RoleInfo {
  id: string
  name: string
  color: string
}

interface PermDiff {
  added: string[]
  removed: string[]
}

interface ActivityEvent {
  id: string
  action: string
  created_at: string
  actor_id: string | null
  target_id: string | null
  target_type: string | null
  changes: Record<string, unknown> | null
  reason: string | null
  actor: UserInfo | null
  target_user: UserInfo | null
  target_role: RoleInfo | null
  perm_diff: PermDiff | null
}

interface ActivityPayload {
  data: ActivityEvent[]
  next_cursor: string | null
  total: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  role_created: "Role Created",
  role_updated: "Role Updated",
  role_deleted: "Role Deleted",
  role_assigned: "Role Assigned",
  role_removed: "Role Removed",
  channel_permissions_updated: "Channel Perms Updated",
  channel_permissions_deleted: "Channel Perms Removed",
  moderation_settings_updated: "Moderation Settings Updated",
  member_ban: "Member Banned",
  member_kick: "Member Kicked",
  member_timeout: "Member Timed Out",
  member_timeout_remove: "Timeout Removed",
  automod_rule_created: "AutoMod Rule Created",
  automod_rule_updated: "AutoMod Rule Updated",
  automod_rule_deleted: "AutoMod Rule Deleted",
  appeal_status_changed: "Appeal Updated",
}

const ACTION_CATEGORY: Record<string, string> = {
  role_created: "role",
  role_updated: "role",
  role_deleted: "role",
  role_assigned: "role",
  role_removed: "role",
  channel_permissions_updated: "permissions",
  channel_permissions_deleted: "permissions",
  moderation_settings_updated: "settings",
  member_ban: "moderation",
  member_kick: "moderation",
  member_timeout: "moderation",
  member_timeout_remove: "moderation",
  automod_rule_created: "automod",
  automod_rule_updated: "automod",
  automod_rule_deleted: "automod",
  appeal_status_changed: "moderation",
}

const CATEGORY_CSS_VARS: Record<string, string> = {
  role: "--theme-cat-role",
  permissions: "--theme-cat-channel",
  settings: "--theme-cat-server",
  moderation: "--theme-cat-member",
  automod: "--theme-cat-automod",
}

const ALL_ACTIONS = Object.keys(ACTION_LABELS)

function actorName(event: ActivityEvent) {
  return event.actor?.display_name ?? event.actor?.username ?? event.actor_id ?? "system"
}

function targetName(event: ActivityEvent) {
  if (event.target_user) return event.target_user.display_name ?? event.target_user.username
  if (event.target_role) return `@${event.target_role.name}`
  return event.target_id ?? "—"
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PermDiffBadges({ diff }: { diff: PermDiff }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {diff.added.map((p) => (
        <span key={`add-${p}`} className="inline-flex items-center gap-0.5 text-xs bg-green-900/30 text-green-300 border border-green-800 rounded px-1.5 py-0.5">
          <PlusCircle className="w-3 h-3" />{p}
        </span>
      ))}
      {diff.removed.map((p) => (
        <span key={`rm-${p}`} className="inline-flex items-center gap-0.5 text-xs bg-red-900/30 text-red-300 border border-red-800 rounded px-1.5 py-0.5">
          <MinusCircle className="w-3 h-3" />{p}
        </span>
      ))}
    </div>
  )
}

function ChangeDiff({ changes }: { changes: Record<string, unknown> | null }) {
  if (!changes) return null

  const before = changes.before as Record<string, unknown> | null
  const after = changes.after as Record<string, unknown> | null
  if (!before && !after) return null

  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
  if (keys.length === 0) return null

  return (
    <div className="rounded bg-zinc-950 border border-zinc-800 p-2 text-xs mt-2">
      <p className="text-zinc-500 mb-1">Before → After</p>
      <div className="space-y-1">
        {keys.map((key) => {
          const b = before?.[key]
          const a = after?.[key]
          if (JSON.stringify(b) === JSON.stringify(a)) return null
          return (
            <div key={key} className="grid grid-cols-[6rem_1fr_1fr] gap-2">
              <span className="text-zinc-400">{key}</span>
              <span className="text-red-300 break-all">{JSON.stringify(b) ?? "—"}</span>
              <span className="text-green-300 break-all">{JSON.stringify(a) ?? "—"}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminActivityTimeline({ serverId }: { serverId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Filters
  const [actorId, setActorId] = useState("")
  const [targetId, setTargetId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [selectedActions, setSelectedActions] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>("")

  const params = useMemo(() => {
    const search = new URLSearchParams({ limit: "50" })
    if (actorId.trim()) search.set("actor_id", actorId.trim())
    if (targetId.trim()) search.set("target_id", targetId.trim())
    if (from) search.set("from", new Date(from).toISOString())
    if (to) search.set("to", new Date(to).toISOString())
    // When a category filter is active, we pass each action of that category.
    // When a specific action is selected, pass that.
    const actionsToSend =
      selectedActions.length > 0
        ? selectedActions
        : selectedCategory
          ? ALL_ACTIONS.filter((a) => ACTION_CATEGORY[a] === selectedCategory)
          : []
    if (actionsToSend.length === 1) search.set("action", actionsToSend[0]!)
    return search
  }, [actorId, from, selectedActions, selectedCategory, targetId, to])

  const load = useCallback(
    async (append = false) => {
      setLoading(true)
      const search = new URLSearchParams(params)
      if (append && cursor) search.set("cursor", cursor)

      const res = await fetch(
        `/api/servers/${serverId}/admin/activity?${search.toString()}`
      )
      if (!res.ok) {
        setLoading(false)
        return
      }
      const payload = (await res.json()) as ActivityPayload
      setEvents((prev) => (append ? [...prev, ...payload.data] : payload.data))
      setCursor(payload.next_cursor)
      setTotal(payload.total)
      setLoading(false)
    },
    [cursor, params, serverId]
  )

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categories = Array.from(new Set(Object.values(ACTION_CATEGORY)))

  function toggleAction(action: string) {
    setSelectedActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    )
  }

  return (
    <section className="space-y-4 text-zinc-100">
      <header>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <History className="w-5 h-5 text-purple-400" />
          Admin Activity Timeline
        </h2>
        <p className="text-sm text-zinc-400 mt-0.5">
          Audit trail for role, permission, and moderation changes — with actor, timestamp, and before/after diffs.
          {total !== null && (
            <span className="ml-2 text-zinc-500">~{total.toLocaleString()} total events</span>
          )}
        </p>
      </header>

      {/* Filters */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <p className="text-sm text-zinc-300 flex items-center gap-1.5">
          <Filter className="w-4 h-4" /> Filters
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input placeholder="Actor user ID" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          <Input placeholder="Target ID (user or role)" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {/* Category quick-filter */}
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant={selectedCategory === cat ? "default" : "outline"}
              onClick={() => {
                setSelectedCategory((prev) => (prev === cat ? "" : cat))
                setSelectedActions([])
              }}
              className="capitalize"
              style={CATEGORY_CSS_VARS[cat] ? { color: `var(${CATEGORY_CSS_VARS[cat]})` } : undefined}
            >
              {cat}
            </Button>
          ))}
          {(selectedCategory || selectedActions.length > 0) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSelectedCategory(""); setSelectedActions([]) }}
              className="text-zinc-400"
            >
              Clear
            </Button>
          )}
        </div>

        {/* Fine-grained action filter */}
        {selectedCategory && (
          <div className="flex flex-wrap gap-1.5">
            {ALL_ACTIONS.filter((a) => ACTION_CATEGORY[a] === selectedCategory).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={selectedActions.includes(action) ? "default" : "outline"}
                onClick={() => toggleAction(action)}
                className="text-xs"
              >
                {ACTION_LABELS[action] ?? action}
              </Button>
            ))}
          </div>
        )}

        <Button onClick={() => load(false)} disabled={loading} size="sm">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Apply Filters
        </Button>
      </div>

      {/* Event list */}
      <div className="space-y-2">
        {events.length === 0 && !loading && (
          <p className="text-sm text-zinc-500 flex items-center gap-1.5 py-4">
            <UserCog className="w-4 h-4" /> No admin activity events found.
          </p>
        )}

        {events.map((event) => {
          const isOpen = !!expanded[event.id]
          const category = ACTION_CATEGORY[event.action] ?? "other"
          const catVar = CATEGORY_CSS_VARS[category] ?? "--theme-cat-other"

          return (
            <article
              key={event.id}
              className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
            >
              <button
                className="w-full text-left flex items-start justify-between gap-2"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [event.id]: !isOpen }))
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: `var(${catVar})` }}>
                      {ACTION_LABELS[event.action] ?? event.action}
                    </span>
                    <span className="text-xs capitalize" style={{ color: "var(--theme-text-muted)" }}>{category}</span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">
                    <span className="text-zinc-300">{actorName(event)}</span>
                    {" → "}
                    <span className="text-zinc-300">{targetName(event)}</span>
                    {event.target_role && (
                      <span
                        className="ml-1 inline-block w-2 h-2 rounded-full"
                        style={{ background: event.target_role.color }}
                      />
                    )}
                  </p>
                </div>
                <span className="text-xs text-zinc-500 flex items-center gap-1 flex-shrink-0">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  {format(new Date(event.created_at), "MMM d, HH:mm")}
                </span>
              </button>

              {isOpen && (
                <div className="mt-3 space-y-2 text-sm">
                  {event.reason && (
                    <p className="text-zinc-300">
                      <span className="text-zinc-500">Reason: </span>{event.reason}
                    </p>
                  )}

                  <div className="text-xs text-zinc-500 space-y-0.5">
                    <p>Event ID: {event.id}</p>
                    <p>Timestamp: {new Date(event.created_at).toLocaleString()}</p>
                    {event.actor_id && <p>Actor ID: {event.actor_id}</p>}
                    {event.target_id && <p>Target ID: {event.target_id} ({event.target_type})</p>}
                  </div>

                  {/* Permission diff */}
                  {event.perm_diff && (event.perm_diff.added.length > 0 || event.perm_diff.removed.length > 0) && (
                    <div>
                      <p className="text-xs text-zinc-400 font-medium">Permission changes:</p>
                      <PermDiffBadges diff={event.perm_diff} />
                    </div>
                  )}

                  {/* Generic before/after diff */}
                  {event.changes && <ChangeDiff changes={event.changes} />}
                </div>
              )}
            </article>
          )
        })}

        {/* Pagination */}
        <Button
          onClick={() => load(true)}
          disabled={!cursor || loading}
          variant="outline"
          size="sm"
          className="w-full"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin mr-1" />
            : cursor
              ? "Load more"
              : "No more events"}
        </Button>
      </div>
    </section>
  )
}
