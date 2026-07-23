import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { createDb, directMessages, dmChannelMembers, reports } from "@vortex/db"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"
import { REPORT_REASON_VALUES, type ReportReason } from "@/lib/report-reasons"
import { toSnakeCase } from "@/lib/utils/case"

const VALID_REASONS = REPORT_REASON_VALUES
const db = createDb()

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
    const { user, error: authError } = await requireAuth()
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
      const [message] = await db
        .select({ id: directMessages.id, senderId: directMessages.senderId, dmChannelId: directMessages.dmChannelId })
        .from(directMessages)
        .where(eq(directMessages.id, reported_message_id))
        .limit(1)

      if (!message) {
        return NextResponse.json({ error: "Reported message not found" }, { status: 404 })
      }

      if (message.senderId !== reported_user_id) {
        return NextResponse.json({ error: "Reported user does not match message author" }, { status: 400 })
      }

      if (!message.dmChannelId) {
        return NextResponse.json({ error: "Reported message is not part of a conversation" }, { status: 400 })
      }

      const [membership] = await db
        .select({ userId: dmChannelMembers.userId })
        .from(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, message.dmChannelId), eq(dmChannelMembers.userId, user.id)))
        .limit(1)

      if (!membership) {
        return NextResponse.json({ error: "You are not a member of this conversation" }, { status: 403 })
      }
    }

    let report: typeof reports.$inferSelect
    try {
      const [row] = await db
        .insert(reports)
        .values({
          reporterId: user.id,
          reportedUserId: reported_user_id,
          reportedMessageId: reported_message_id || null,
          reason: reason as "spam" | "harassment" | "inappropriate_content" | "other",
          description: description?.trim() || null,
          status: "pending",
        })
        .returning()
      if (!row) throw new Error("insert returned no row")
      report = row
    } catch {
      return NextResponse.json({ error: "Failed to create report" }, { status: 500 })
    }

    return NextResponse.json(toSnakeCase(report), { status: 201 })
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
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    let rows: (typeof reports.$inferSelect)[]
    try {
      rows = await db
        .select()
        .from(reports)
        .where(eq(reports.reporterId, user.id))
        .orderBy(desc(reports.createdAt))
        .limit(50)
    } catch {
      return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
    }

    return NextResponse.json(toSnakeCase(rows), {
      headers: { "Cache-Control": "private, max-age=30" },
    })
  } catch (err) {
    console.error("[reports GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
