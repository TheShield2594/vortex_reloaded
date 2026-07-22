import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"

/**
 * GET /api/servers/[serverId]/audit-log
 *
 * Query parameters:
 *   limit      – max entries to return (default 50, max 100)
 *   before     – ISO timestamp for cursor-based pagination
 *   action     – filter by a specific action type (e.g. "member_ban")
 *   actor_id   – filter by the actor who performed the action
 *   target_id  – filter by the target of the action
 *   from       – ISO timestamp lower bound (inclusive)
 *   to         – ISO timestamp upper bound (inclusive)
 *   format     – "json" (default) or "csv" for export
 *
 * Accessible by server owners, ADMINISTRATOR, or MANAGE_CHANNELS holders.
 * Entries older than 180 days are excluded.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const perms = await getMemberPermissions(supabase, serverId, user.id)
    const canView =
      perms.isOwner ||
      perms.isAdmin ||
      hasPermission(perms.permissions, "MANAGE_CHANNELS")

    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)
    const before = searchParams.get("before")
    const actionFilter = searchParams.get("action")
    const actorFilter = searchParams.get("actor_id")
    const targetFilter = searchParams.get("target_id")
    const from = searchParams.get("from")
    const to = searchParams.get("to")
    const exportFormat = searchParams.get("format") ?? "json"
    if (exportFormat !== "json" && exportFormat !== "csv") {
      return NextResponse.json({ error: "Invalid format. Use 'json' or 'csv'." }, { status: 400 })
    }

    // Enforce 180-day retention window
    const retentionCutoff = new Date()
    retentionCutoff.setDate(retentionCutoff.getDate() - 180)

    let query = supabase
      .from("audit_logs")
      .select("id, action, actor_id, target_id, target_type, changes, created_at")
      .eq("server_id", serverId)
      .gte("created_at", retentionCutoff.toISOString())
      .order("created_at", { ascending: false })
      .limit(exportFormat !== "json" ? 1000 : limit)

    if (before) query = query.lt("created_at", before)
    if (from) query = query.gte("created_at", from)
    if (to) query = query.lte("created_at", to)
    if (actionFilter) query = query.eq("action", actionFilter)
    if (actorFilter) query = query.eq("actor_id", actorFilter)
    if (targetFilter) query = query.eq("target_id", targetFilter)

    const { data: entries, error } = await query
    if (error) return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 })
    if (!entries?.length) {
      if (exportFormat === "csv") {
        return new NextResponse(buildCsv([]), {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="audit-log-${serverId}.csv"`,
          },
        })
      }
      return NextResponse.json({ entries: [], next_before: null })
    }

    // Hydrate actor and target user info
    const userIds = new Set<string>()
    for (const e of entries) {
      if (e.actor_id) userIds.add(e.actor_id)
      if (e.target_id && e.target_type === "user") userIds.add(e.target_id)
    }

    const { data: users } = await supabase
      .from("users")
      .select("id, username, display_name, avatar_url")
      .in("id", Array.from(userIds))

    const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]))

    const result = entries.map((e) => ({
      id: e.id,
      action: e.action,
      reason: (e.changes as { reason?: string } | null | undefined)?.reason ?? null,
      metadata: e.changes,
      created_at: e.created_at,
      actor: e.actor_id ? (userMap[e.actor_id] ?? null) : null,
      target:
        e.target_id && e.target_type === "user"
          ? (userMap[e.target_id] ?? null)
          : null,
      target_id: e.target_id,
      target_type: e.target_type,
    }))

    if (exportFormat === "csv") {
      // Stream CSV via a ReadableStream. Encode the full CSV to a byte array
      // first (avoiding UTF-16 surrogate pair corruption from string slicing),
      // then chunk the bytes through the stream to reduce peak memory.
      const csvContent = buildCsv(result)
      const encoded = new TextEncoder().encode(csvContent)
      const CHUNK_SIZE = 65536
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < encoded.byteLength; i += CHUNK_SIZE) {
            controller.enqueue(encoded.subarray(i, i + CHUNK_SIZE))
          }
          controller.close()
        },
      })
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-log-${serverId}.csv"`,
        },
      })
    }

    const next_before =
      result.length === limit ? result[result.length - 1]?.created_at ?? null : null

    return NextResponse.json({ entries: result, next_before })

  } catch (err) {
    console.error("[servers/[serverId]/audit-log GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

interface AuditRow {
  id: string
  action: string
  reason: string | null
  created_at: string
  actor: { username: string; display_name: string | null } | null
  target: { username: string; display_name: string | null } | null
  target_id: string | null
  target_type: string | null
  metadata: unknown
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ""
  const str = typeof value === "object" ? JSON.stringify(value) : String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function buildCsv(rows: AuditRow[]): string {
  const headers = [
    "id",
    "action",
    "actor_username",
    "actor_display_name",
    "target_username",
    "target_display_name",
    "target_id",
    "target_type",
    "reason",
    "timestamp",
    "details",
  ]

  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.action,
        row.actor?.username ?? "",
        row.actor?.display_name ?? "",
        row.target?.username ?? "",
        row.target?.display_name ?? "",
        row.target_id ?? "",
        row.target_type ?? "",
        row.reason ?? "",
        row.created_at,
        row.metadata,
      ]
        .map(csvEscape)
        .join(",")
    )
  }

  return lines.join("\n")
}
