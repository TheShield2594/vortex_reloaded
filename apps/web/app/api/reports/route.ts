import { NextRequest, NextResponse } from "next/server"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { REPORT_REASON_VALUES, type ReportReason } from "@/lib/report-reasons"

const VALID_REASONS = REPORT_REASON_VALUES

/**
 * POST /api/reports — submit a report (e.g. abusive DM behavior)
 *
 * Body: {
 *   reported_user_id: string
 *   reported_message_id?: string
 *   reason: "spam" | "harassment" | "inappropriate_content" | "other"
 *   description?: string (max 1000 chars)
 * }
 *
 * Intentionally dormant: no DM UI currently links to this route (decided in
 * issue #16 rather than left as an accident). It survived the server/App
 * Store strip and was adapted to validate against DMs, so the backend is
 * ready — wire up a "Report" action (e.g. a message context-menu entry in
 * dm-channel-area.tsx) when that UI is prioritized.
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
      reason?: string
      description?: string
    }>(req)
    if (parseError) return parseError

    const { reported_user_id, reported_message_id, reason, description } = body

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

    // Validate reported_message_id if provided — must be a DM the reporter can see
    if (reported_message_id) {
      const { data: message } = await supabase
        .from("direct_messages")
        .select("id, sender_id, dm_channel_id")
        .eq("id", reported_message_id)
        .maybeSingle()

      if (!message) {
        return NextResponse.json({ error: "Reported message not found" }, { status: 404 })
      }

      if (message.sender_id !== reported_user_id) {
        return NextResponse.json({ error: "Reported user does not match message author" }, { status: 400 })
      }

      if (!message.dm_channel_id) {
        return NextResponse.json({ error: "Reported message is not part of a conversation" }, { status: 400 })
      }

      const { data: membership } = await supabase
        .from("dm_channel_members")
        .select("user_id")
        .eq("dm_channel_id", message.dm_channel_id)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!membership) {
        return NextResponse.json({ error: "You are not a member of this conversation" }, { status: 403 })
      }
    }

    const { data: report, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: user.id,
        reported_user_id,
        reported_message_id: reported_message_id || null,
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
 * GET /api/reports — the caller's own submitted reports
 */
export async function GET(_req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

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
