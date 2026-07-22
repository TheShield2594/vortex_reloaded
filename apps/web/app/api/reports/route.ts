import { NextRequest, NextResponse } from "next/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { requireAuth, parseJsonBody, insertAuditLog, checkRateLimit } from "@/lib/utils/api-helpers"
import { REPORT_REASON_VALUES, type ReportReason } from "@/lib/report-reasons"
import { REPORT_STATUSES, REPORT_STATUS_TRANSITIONS, type ReportStatus } from "@/lib/report-status"
import type { MessageWithChannelServerId } from "@/types/database"

const VALID_REASONS = REPORT_REASON_VALUES


// The reports table is defined in migration 00035_reports.sql but is not yet
// reflected in the generated Supabase types.  We cast through `any` for
// reports table access — the same pattern used elsewhere in the codebase for
// runtime types that differ from TS interfaces.

/**
 * POST /api/reports — submit a report
 *
 * Body: {
 *   reported_user_id: string
 *   reported_message_id?: string
 *   server_id?: string
 *   reason: "spam" | "harassment" | "inappropriate_content" | "other"
 *   description?: string (max 1000 chars)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "reports:submit", { limit: 10, windowMs: 3600_000 })
    if (limited) return limited

    const { data: body, error: parseError } = await parseJsonBody<{
      reported_user_id?: string
      reported_message_id?: string
      server_id?: string
      reason?: string
      description?: string
    }>(req)
    if (parseError) return parseError

    const { reported_user_id, reported_message_id, server_id, reason, description } = body

    if (!reported_user_id || typeof reported_user_id !== "string") {
      return NextResponse.json({ error: "reported_user_id is required" }, { status: 400 })
    }

    if (reported_user_id === user.id) {
      return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 })
    }

    if (!reason || !VALID_REASONS.includes(reason as ReportReason)) {
      return NextResponse.json(
        { error: `reason must be one of: ${VALID_REASONS.join(", ")}` },
        { status: 400 }
      )
    }

    if (description !== undefined && description !== null) {
      if (typeof description !== "string") {
        return NextResponse.json({ error: "description must be a string" }, { status: 400 })
      }
      if (description.length > 1000) {
        return NextResponse.json(
          { error: "description must not exceed 1000 characters" },
          { status: 400 }
        )
      }
    }

    // Validate server_id if provided — reporter must be a member
    if (server_id) {
      const { data: membership } = await supabase
        .from("server_members")
        .select("server_id")
        .eq("server_id", server_id)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!membership) {
        return NextResponse.json({ error: "You are not a member of this server" }, { status: 403 })
      }
    }

    // Validate reported_message_id if provided
    if (reported_message_id) {
      const { data: message } = await supabase
        .from("messages")
        .select("id, author_id, channel_id, channels!inner(server_id)")
        .eq("id", reported_message_id)
        .maybeSingle()

      if (!message) {
        return NextResponse.json({ error: "Reported message not found" }, { status: 404 })
      }

      if (message.author_id !== reported_user_id) {
        return NextResponse.json({ error: "Reported user does not match message author" }, { status: 400 })
      }

      // Verify the message belongs to the reported server
      if (server_id) {
        const msgServerId = (message as unknown as MessageWithChannelServerId).channels?.server_id
        if (msgServerId && msgServerId !== server_id) {
          return NextResponse.json({ error: "Message does not belong to this server" }, { status: 400 })
        }
      }
    }

    const { data: report, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: user.id,
        reported_user_id,
        reported_message_id: reported_message_id || null,
        server_id: server_id || null,
        reason: reason as "spam" | "harassment" | "inappropriate_content" | "other",
        description: description?.trim() || null,
        status: "pending" as const,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: "Failed to create report" }, { status: 500 })

    return NextResponse.json(report, { status: 201 })
  } catch (err) {
    console.error("[reports POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * GET /api/reports?server_id=...&status=...
 *
 * Moderator view: requires MANAGE_MESSAGES or ADMINISTRATOR permission (or owner).
 * Without server_id, returns the caller's own reports.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { searchParams } = new URL(req.url)
    const serverId = searchParams.get("server_id")
    const statusFilter = searchParams.get("status")

    if (serverId) {
      // Moderator view — requires permission
      const { isOwner, isAdmin, permissions } = await getMemberPermissions(
        supabase,
        serverId,
        user.id
      )

      if (!isOwner && !isAdmin && !hasPermission(permissions, "MANAGE_MESSAGES")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      let query = supabase
        .from("reports")
        .select(
          "*, reporter:users!reports_reporter_id_fkey(id, username, display_name, avatar_url), reported_user:users!reports_reported_user_id_fkey(id, username, display_name, avatar_url), reviewer:users!reports_reviewed_by_fkey(id, username, display_name)"
        )
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(100)

      if (statusFilter) {
        if (!REPORT_STATUSES.includes(statusFilter as ReportStatus)) {
          return NextResponse.json({ error: "Invalid status filter" }, { status: 400 })
        }
        query = query.eq("status", statusFilter as ReportStatus)
      }

      const { data: reports, error } = await query
      if (error) return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
      return NextResponse.json(reports, {
        headers: { "Cache-Control": "private, max-age=30" },
      })
    }

    // No server_id — return caller's own reports
    const { data: reports, error } = await supabase
      .from("reports")
      .select("*")
      .eq("reporter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
    return NextResponse.json(reports, {
      headers: { "Cache-Control": "private, max-age=30" },
    })

  } catch (err) {
    console.error("[reports GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/reports — update a report status (moderator action)
 *
 * Body: {
 *   report_id: string
 *   server_id: string
 *   status: "reviewed" | "resolved" | "dismissed"
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data: body, error: parseError } = await parseJsonBody<{ report_id?: string; server_id?: string; status?: string }>(req)
    if (parseError) return parseError

    const { report_id, server_id, status } = body

    if (!report_id || !server_id || !status) {
      return NextResponse.json(
        { error: "report_id, server_id, and status are required" },
        { status: 400 }
      )
    }

    if (!REPORT_STATUS_TRANSITIONS.includes(status as ReportStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${REPORT_STATUS_TRANSITIONS.join(", ")}` },
        { status: 400 }
      )
    }

    // Permission check
    const { isOwner, isAdmin, permissions } = await getMemberPermissions(
      supabase,
      server_id,
      user.id
    )

    if (!isOwner && !isAdmin && !hasPermission(permissions, "MANAGE_MESSAGES")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch current status before updating for accurate audit trail
    const { data: existingReport, error: lookupError } = await supabase
      .from("reports")
      .select("status")
      .eq("id", report_id)
      .eq("server_id", server_id)
      .single()

    if (lookupError || !existingReport) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 })
    }

    const previousStatus = existingReport.status

    const { data: report, error } = await supabase
      .from("reports")
      .update({
        status: status as ReportStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", report_id)
      .eq("server_id", server_id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: "Failed to update report" }, { status: 500 })
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 })

    // Audit log the moderator action on this report
    await insertAuditLog(supabase, {
      server_id,
      actor_id: user.id,
      action: `report_${status}`,
      target_id: report.reported_user_id,
      target_type: "user",
      changes: {
        report_id,
        previous_status: previousStatus,
        new_status: status,
        reason: report.reason,
      },
    })

    return NextResponse.json(report)

  } catch (err) {
    console.error("[reports PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
