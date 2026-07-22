import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import {
  deriveIncidentKey,
  getRawActionsForTypes,
  mapActionType,
  timelineToCsv,
  type TimelineActionType,
  type TimelineCursor,
  type TimelineEvent,
} from "@/lib/mod-ledger"

function parseActionTypes(raw: string | null): TimelineActionType[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token): token is TimelineActionType =>
      ["ban", "kick", "timeout", "message_action", "automod", "appeal", "role_change", "settings", "other"].includes(token)
    )
}

function parseCursor(raw: string | null): TimelineCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as TimelineCursor
    if (!parsed?.created_at || !parsed?.id) return null
    // Validate timestamp and UUID to prevent malformed cursor interpolation
    if (isNaN(Date.parse(parsed.created_at))) return null
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(parsed.id)) return null
    return parsed
  } catch {
    return null
  }
}

function encodeCursor(cursor: TimelineCursor | null): string | null {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: server } = await supabase
      .from("servers")
      .select("owner_id")
      .eq("id", serverId)
      .single()

    if (server?.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10), 1), 200)
    const cursor = parseCursor(searchParams.get("cursor"))

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    const filters = {
      actorId: searchParams.get("actor_id"),
      targetId: searchParams.get("target_id"),
      actionTypes: parseActionTypes(searchParams.get("action_types")),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    }

    // Validate filter inputs before passing to DB
    if (filters.actorId && !uuidRegex.test(filters.actorId)) {
      return NextResponse.json({ error: "Invalid actor_id format" }, { status: 400 })
    }
    if (filters.targetId && !uuidRegex.test(filters.targetId)) {
      return NextResponse.json({ error: "Invalid target_id format" }, { status: 400 })
    }
    if (filters.from && isNaN(Date.parse(filters.from))) {
      return NextResponse.json({ error: "Invalid from timestamp" }, { status: 400 })
    }
    if (filters.to && isNaN(Date.parse(filters.to))) {
      return NextResponse.json({ error: "Invalid to timestamp" }, { status: 400 })
    }

    // Build the query with DB-level filtering instead of fetching all rows.
    let query = supabase
      .from("audit_logs")
      .select("id, action, actor_id, target_id, target_type, changes, created_at")
      .eq("server_id", serverId)

    if (filters.actorId) query = query.eq("actor_id", filters.actorId)
    if (filters.targetId) query = query.eq("target_id", filters.targetId)
    if (filters.from) query = query.gte("created_at", filters.from)
    if (filters.to) query = query.lte("created_at", filters.to)

    // Reverse-map action_types to raw action column values for DB-level filtering.
    // If "other" is requested, rawActions is null and we fall back to JS filtering.
    const rawActions = filters.actionTypes.length > 0 ? getRawActionsForTypes(filters.actionTypes) : null
    const needsJsActionFilter = filters.actionTypes.length > 0 && rawActions === null
    if (rawActions) query = query.in("action", rawActions)

    // Apply cursor-based pagination at the DB level
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    }

    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })

    // When "other" action_type is requested we can't filter at DB level,
    // so over-fetch to compensate for JS filtering.
    const fetchLimit = needsJsActionFilter ? limit * 10 : limit + 1
    query = query.limit(fetchLimit)

    const { data: logs, error } = await query

    if (error) return NextResponse.json({ error: "Failed to fetch moderation timeline" }, { status: 500 })

    const entries: TimelineEvent[] = (logs ?? []).map((log) => {
      const metadata = (log.changes ?? null) as Record<string, unknown> | null
      const action_type = mapActionType(log.action)
      const base = {
        id: log.id,
        action: log.action,
        action_type,
        created_at: log.created_at,
        actor_id: log.actor_id,
        target_id: log.target_id,
        target_type: log.target_type,
        reason: (metadata?.reason as string | undefined) ?? null,
        metadata,
        actor: null,
        target: null,
      } satisfies Omit<TimelineEvent, "incident_key">

      return {
        ...base,
        incident_key: deriveIncidentKey({
          action_type,
          target_id: base.target_id,
          metadata,
          created_at: base.created_at,
        }),
      }
    })

    // JS filtering only needed for "other" action_type (can't be reverse-mapped)
    const filtered = needsJsActionFilter
      ? entries.filter((e) => new Set(filters.actionTypes).has(e.action_type))
      : entries
    const page = filtered.slice(0, limit)
    const lastPageItem = page.at(-1)
    const nextCursor: TimelineCursor | null = page.length === limit && filtered.length > limit && lastPageItem
      ? { created_at: lastPageItem.created_at, id: lastPageItem.id }
      : null

    const userIds = new Set<string>()
    for (const event of page) {
      if (event.actor_id) userIds.add(event.actor_id)
      if (event.target_id && event.target_type === "user") userIds.add(event.target_id)
    }

    let users: Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null }> = []
    if (userIds.size) {
      const { data: fetchedUsers } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url")
        .in("id", Array.from(userIds))
      users = (fetchedUsers ?? []) as typeof users
    }

    const userMap = Object.fromEntries((users ?? []).map((row) => [row.id, row]))
    const hydrated = page.map((event) => ({
      ...event,
      actor: event.actor_id ? userMap[event.actor_id] ?? null : null,
      target: event.target_id && event.target_type === "user" ? userMap[event.target_id] ?? null : null,
    }))

    const format = (searchParams.get("format") ?? "json").toLowerCase()
    if (format === "csv") {
      const csv = timelineToCsv(hydrated)
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="mod-ledger-${serverId}.csv"`,
        },
      })
    }

    const grouped = hydrated.reduce<Record<string, TimelineEvent[]>>((acc, event) => {
      if (!acc[event.incident_key]) acc[event.incident_key] = []
      acc[event.incident_key].push(event)
      return acc
    }, {})

    return NextResponse.json({
      data: hydrated,
      incidents: Object.entries(grouped).map(([incident_key, incidentEvents]) => ({
        incident_key,
        count: incidentEvents.length,
        started_at: incidentEvents[incidentEvents.length - 1]?.created_at ?? null,
        latest_at: incidentEvents[0]?.created_at ?? null,
        events: incidentEvents,
      })),
      next_cursor: encodeCursor(nextCursor),
    })

  } catch (err) {
    console.error("[servers/[serverId]/moderation/timeline GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
