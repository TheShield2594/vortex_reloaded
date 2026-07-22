/**
 * GET /api/servers/[serverId]/admin/activity
 *
 * Admin-focused activity timeline scoped to role, permission, and moderation
 * changes.  Returns paginated audit_log events with enriched actor info and
 * before/after diffs.  Only accessible by server owners / administrators.
 *
 * Query params:
 *   limit        – max events per page (1-200, default 50)
 *   cursor       – base64url-encoded cursor from previous response
 *   actor_id     – filter by actor user ID
 *   target_id    – filter by target ID (user or role)
 *   target_type  – filter by target_type ('user' | 'role' | 'channel')
 *   action       – filter to a specific action string (e.g. "role_updated")
 *   from         – ISO timestamp lower bound
 *   to           – ISO timestamp upper bound
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions } from "@/lib/permissions"
import { diffPermissions } from "@/lib/permission-simulation"

/** Actions considered part of the admin activity stream. */
const ADMIN_ACTIONS = new Set([
  "role_created",
  "role_updated",
  "role_deleted",
  "role_assigned",
  "role_removed",
  "channel_permissions_updated",
  "channel_permissions_deleted",
  "moderation_settings_updated",
  "member_ban",
  "member_kick",
  "member_timeout",
  "member_timeout_remove",
  "automod_rule_created",
  "automod_rule_updated",
  "automod_rule_deleted",
  "appeal_status_changed",
])

interface CursorPayload { created_at: string; id: string }

function parseCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorPayload
    if (!parsed?.created_at || !parsed?.id) return null
    return parsed
  } catch {
    return null
  }
}

function encodeCursor(c: CursorPayload | null): string | null {
  if (!c) return null
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { isAdmin } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10), 1), 200)
    const cursor = parseCursor(searchParams.get("cursor"))
    const actorId = searchParams.get("actor_id")
    const targetId = searchParams.get("target_id")
    const targetType = searchParams.get("target_type")
    const actionFilter = searchParams.get("action")
    const fromParam = searchParams.get("from")
    const toParam = searchParams.get("to")

    // Determine which actions to include
    const allowedActions = actionFilter
      ? ADMIN_ACTIONS.has(actionFilter) ? [actionFilter] : []
      : Array.from(ADMIN_ACTIONS)

    if (allowedActions.length === 0) {
      return NextResponse.json({ data: [], next_cursor: null, total: 0 })
    }

    // Build the query.  We fetch one extra row to detect whether a next page exists.
    let query = supabase
      .from("audit_logs")
      .select("id, action, actor_id, target_id, target_type, changes, created_at", { count: "estimated" })
      .eq("server_id", serverId)
      .in("action", allowedActions)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)

    if (actorId) query = query.eq("actor_id", actorId)
    if (targetId) query = query.eq("target_id", targetId)
    if (targetType) query = query.eq("target_type", targetType)
    if (fromParam) query = query.gte("created_at", new Date(fromParam).toISOString())
    if (toParam) query = query.lte("created_at", new Date(toParam).toISOString())

    // Cursor-based keyset pagination
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
      )
    }

    const { data: logs, error, count } = await query
    if (error) return NextResponse.json({ error: "Failed to fetch activity logs" }, { status: 500 })

    const rows = logs ?? []
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const lastRow = page.at(-1)
    const nextCursor = hasMore && lastRow
      ? encodeCursor({ created_at: lastRow.created_at, id: lastRow.id })
      : null

    // Hydrate actors and targets
    const userIds = new Set<string>()
    for (const row of page) {
      if (row.actor_id) userIds.add(row.actor_id)
      if (row.target_id && row.target_type === "user") userIds.add(row.target_id)
    }

    const roleIds = new Set<string>()
    for (const row of page) {
      if (row.target_id && row.target_type === "role") roleIds.add(row.target_id)
    }

    const [usersResult, rolesResult] = await Promise.all([
      userIds.size
        ? supabase
            .from("users")
            .select("id, username, display_name, avatar_url")
            .in("id", Array.from(userIds))
        : Promise.resolve({ data: [], error: null }),
      roleIds.size
        ? supabase
            .from("roles")
            .select("id, name, color")
            .in("id", Array.from(roleIds))
        : Promise.resolve({ data: [], error: null }),
    ])

    const userMap = Object.fromEntries(
      ((usersResult.data ?? []) as Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null }>).map((u) => [u.id, u])
    )
    const roleMap = Object.fromEntries(
      ((rolesResult.data ?? []) as Array<{ id: string; name: string; color: string }>).map((r) => [r.id, r])
    )

    const enriched = page.map((row) => {
      const changes = (row.changes ?? null) as Record<string, unknown> | null
      const before = changes?.before as Record<string, unknown> | null ?? null
      const after = changes?.after as Record<string, unknown> | null ?? null

      // Build a human-readable permission diff when the change includes a permissions field
      let permDiff: { added: string[]; removed: string[] } | null = null
      const beforePerms = typeof before?.permissions === "number" ? before.permissions : null
      const afterPerms = typeof after?.permissions === "number" ? after.permissions : null
      if (beforePerms !== null && afterPerms !== null) {
        permDiff = diffPermissions(beforePerms, afterPerms)
      }

      return {
        id: row.id,
        action: row.action,
        created_at: row.created_at,
        actor_id: row.actor_id,
        target_id: row.target_id,
        target_type: row.target_type,
        changes,
        reason: (changes?.reason as string | undefined) ?? null,
        actor: row.actor_id ? userMap[row.actor_id] ?? null : null,
        target_user: row.target_id && row.target_type === "user" ? userMap[row.target_id] ?? null : null,
        target_role: row.target_id && row.target_type === "role" ? roleMap[row.target_id] ?? null : null,
        perm_diff: permDiff,
      }
    })

    return NextResponse.json({
      data: enriched,
      next_cursor: nextCursor,
      total: count ?? null,
    })

  } catch (err) {
    console.error("[servers/[serverId]/admin/activity GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
