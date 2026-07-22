export type TimelineActionType =
  | "ban"
  | "kick"
  | "timeout"
  | "message_action"
  | "automod"
  | "appeal"
  | "role_change"
  | "settings"
  | "other"

export interface TimelineActor {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

export interface TimelineEvent {
  id: string
  action: string
  action_type: TimelineActionType
  created_at: string
  actor_id: string | null
  target_id: string | null
  target_type: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  actor: TimelineActor | null
  target: TimelineActor | null
  incident_key: string
}

export interface TimelineCursor {
  created_at: string
  id: string
}

export interface TimelineFilters {
  actorId?: string | null
  targetId?: string | null
  actionTypes?: TimelineActionType[]
  from?: string | null
  to?: string | null
}

const ACTION_TYPE_MAP: Record<string, TimelineActionType> = {
  member_ban: "ban",
  member_kick: "kick",
  member_timeout: "timeout",
  member_timeout_remove: "timeout",
  automod_block: "automod",
  automod_action: "automod",
  automod_timeout: "automod",
  automod_alert: "automod",
  automod_rule_created: "automod",
  automod_rule_updated: "automod",
  automod_rule_deleted: "automod",
  appeal_status_changed: "appeal",
  role_assigned: "role_change",
  role_removed: "role_change",
  role_created: "role_change",
  role_updated: "role_change",
  role_deleted: "role_change",
  channel_permissions_updated: "settings",
  channel_permissions_deleted: "settings",
  moderation_settings_updated: "settings",
  message_pin: "message_action",
}

function getStringRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function mapActionType(action: string): TimelineActionType {
  return ACTION_TYPE_MAP[action] ?? "other"
}

/** Reverse-maps timeline action types to raw audit_log `action` values for DB filtering. */
export function getRawActionsForTypes(types: TimelineActionType[]): string[] | null {
  const typeSet = new Set(types)
  // "other" maps to everything NOT in ACTION_TYPE_MAP — can't be filtered at DB level
  if (typeSet.has("other")) return null
  const actions: string[] = []
  for (const [rawAction, mappedType] of Object.entries(ACTION_TYPE_MAP)) {
    if (typeSet.has(mappedType)) actions.push(rawAction)
  }
  return actions.length > 0 ? actions : null
}

export function deriveIncidentKey(event: Pick<TimelineEvent, "action_type" | "target_id" | "metadata" | "created_at">): string {
  const metadata = getStringRecord(event.metadata)
  const metadataIncident = metadata?.incident_id
  if (typeof metadataIncident === "string" && metadataIncident) return metadataIncident

  const target = event.target_id ?? "unknown-target"
  const timeBucket = new Date(event.created_at)
  const bucket = Number.isNaN(timeBucket.getTime()) ? "unknown-time" : Math.floor(timeBucket.getTime() / (1000 * 60 * 15))

  const reasonKey = typeof metadata?.reason === "string" ? metadata.reason.toLowerCase().slice(0, 64) : "no-reason"

  return `${event.action_type}:${target}:${reasonKey}:${bucket}`
}

export function applyTimelineFilters(events: TimelineEvent[], filters: TimelineFilters): TimelineEvent[] {
  const actionTypes = filters.actionTypes?.length ? new Set(filters.actionTypes) : null
  const fromMs = filters.from ? Date.parse(filters.from) : Number.NaN
  const toMs = filters.to ? Date.parse(filters.to) : Number.NaN

  return events.filter((event) => {
    if (filters.actorId && event.actor_id !== filters.actorId) return false
    if (filters.targetId && event.target_id !== filters.targetId) return false
    if (actionTypes && !actionTypes.has(event.action_type)) return false

    const createdMs = Date.parse(event.created_at)
    if (!Number.isNaN(fromMs) && (Number.isNaN(createdMs) || createdMs < fromMs)) return false
    if (!Number.isNaN(toMs) && (Number.isNaN(createdMs) || createdMs > toMs)) return false

    return true
  })
}

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const timeA = Date.parse(a.created_at)
    const timeB = Date.parse(b.created_at)
    if (timeA !== timeB) return timeB - timeA
    if (a.id === b.id) return 0
    return a.id < b.id ? 1 : -1
  })
}

export function paginateTimeline(events: TimelineEvent[], limit: number, cursor?: TimelineCursor | null): { data: TimelineEvent[]; nextCursor: TimelineCursor | null } {
  const sorted = sortTimelineEvents(events)
  const startIndex = cursor
    ? sorted.findIndex((event) => event.created_at === cursor.created_at && event.id === cursor.id) + 1
    : 0

  const safeStart = Math.max(0, startIndex)
  const page = sorted.slice(safeStart, safeStart + limit)
  const last = page.at(-1)

  return {
    data: page,
    nextCursor: last && safeStart + limit < sorted.length ? { created_at: last.created_at, id: last.id } : null,
  }
}

export function buildDiffRows(metadata: Record<string, unknown> | null): Array<{ field: string; before: unknown; after: unknown }> {
  if (!metadata) return []

  const explicitBefore = getStringRecord(metadata.before)
  const explicitAfter = getStringRecord(metadata.after)

  if (explicitBefore || explicitAfter) {
    const keys = new Set<string>([...Object.keys(explicitBefore ?? {}), ...Object.keys(explicitAfter ?? {})])
    return Array.from(keys).map((key) => ({
      field: key,
      before: explicitBefore?.[key] ?? null,
      after: explicitAfter?.[key] ?? null,
    }))
  }

  const oldValue = getStringRecord(metadata.old)
  const newValue = getStringRecord(metadata.new)
  if (oldValue || newValue) {
    const keys = new Set<string>([...Object.keys(oldValue ?? {}), ...Object.keys(newValue ?? {})])
    return Array.from(keys).map((key) => ({
      field: key,
      before: oldValue?.[key] ?? null,
      after: newValue?.[key] ?? null,
    }))
  }

  return []
}

export function timelineToCsv(events: TimelineEvent[]): string {
  const headers = ["id", "created_at", "action", "action_type", "actor_id", "target_id", "target_type", "reason", "incident_key"]
  const rows = events.map((event) => [
    event.id,
    event.created_at,
    event.action,
    event.action_type,
    event.actor_id ?? "",
    event.target_id ?? "",
    event.target_type ?? "",
    event.reason ?? "",
    event.incident_key,
  ])

  const escapeCsv = (value: string) => {
    if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
    return value
  }

  return [headers, ...rows].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n")
}
