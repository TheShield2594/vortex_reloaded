import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { rateLimiter } from "@/lib/rate-limit"
import { computeAntiAbuseScore, sanitizeEvidenceAttachments } from "@/lib/appeals"
import { requireAuth, parseJsonBody, insertAuditLog } from "@/lib/utils/api-helpers"

export async function GET() {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data, error } = await supabase
      .from("moderation_appeals")
      .select("id, server_id, status, submitted_at, updated_at, assigned_reviewer_id")
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to fetch appeals" }, { status: 500 })
    return NextResponse.json(data ?? [], {
      headers: { "Cache-Control": "private, max-age=30" },
    })

  } catch (err) {
    console.error("[appeals GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError
    const serviceSupabase = await createServiceRoleClient()

    const { data: payload, error: parseError } = await parseJsonBody(req)
    if (parseError) return parseError

    const body = payload as { serverId?: unknown; statement?: unknown; evidenceAttachments?: unknown }
    const serverId = typeof body.serverId === "string" ? body.serverId : ""
    const statement = typeof body.statement === "string" ? body.statement.trim() : ""

    if (!serverId || statement.length < 20 || statement.length > 4000) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    const evidenceAttachments = sanitizeEvidenceAttachments(body.evidenceAttachments)

    const rate = await rateLimiter.check(`appeals:${user.id}:${serverId}`, { limit: 3, windowMs: 60 * 60 * 1000 })
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many submissions, please try later" }, { status: 429 })
    }

    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Run ban check, duplicate check, and 30-day count in parallel (all independent)
    const [banResult, duplicateResult, countResult] = await Promise.all([
      serviceSupabase
        .from("server_bans")
        .select("server_id, user_id")
        .eq("server_id", serverId)
        .eq("user_id", user.id)
        .maybeSingle(),
      serviceSupabase
        .from("moderation_appeals")
        .select("id")
        .eq("server_id", serverId)
        .eq("user_id", user.id)
        .in("status", ["submitted", "reviewing"])
        .maybeSingle(),
      serviceSupabase
        .from("moderation_appeals")
        .select("id", { count: "exact", head: true })
        .eq("server_id", serverId)
        .eq("user_id", user.id)
        .gte("submitted_at", thirtyDaysAgoIso),
    ])

    if (banResult.error) return NextResponse.json({ error: "Failed to verify ban status" }, { status: 500 })
    if (!banResult.data) {
      return NextResponse.json({ error: "Appeal cannot be created" }, { status: 403 })
    }

    if (duplicateResult.error) return NextResponse.json({ error: "Failed to check existing appeals" }, { status: 500 })
    if (duplicateResult.data) {
      return NextResponse.json({ error: "An active appeal already exists" }, { status: 409 })
    }

    if (countResult.error) return NextResponse.json({ error: "Failed to check appeal history" }, { status: 500 })
    const count = countResult.count

    const antiAbuseScore = computeAntiAbuseScore({
      statement,
      evidenceAttachments,
      recentAppealCount: count ?? 0,
    })

    const { data: appeal, error } = await serviceSupabase
      .from("moderation_appeals")
      .insert({
        server_id: serverId,
        user_id: user.id,
        appellant_statement: statement,
        evidence_attachments: evidenceAttachments,
        anti_abuse_score: antiAbuseScore,
        status: "submitted",
      })
      .select("id, status, submitted_at")
      .single()

    if (error) return NextResponse.json({ error: "Failed to submit appeal" }, { status: 500 })

    const { error: eventError } = await serviceSupabase.from("moderation_appeal_status_events").insert({
      appeal_id: appeal.id,
      server_id: serverId,
      actor_id: user.id,
      previous_status: null,
      new_status: "submitted",
      metadata: { antiAbuseScore },
    })

    if (eventError) {
      console.warn("Failed appeal status event insert", { appealId: appeal.id, moderatorId: user.id, action: "create", error: eventError })
      await serviceSupabase.from("moderation_appeals").delete().eq("id", appeal.id)
      return NextResponse.json({ error: "Failed to create appeal status event" }, { status: 500 })
    }

    const { error: auditError } = await insertAuditLog(serviceSupabase, {
      server_id: serverId,
      actor_id: user.id,
      action: "appeal_status_changed",
      target_id: appeal.id,
      target_type: "appeal",
      changes: { from: null, to: "submitted" },
    })

    if (auditError) {
      console.warn("Failed appeal audit log insert", { appealId: appeal.id, moderatorId: user.id, action: "create", error: auditError })
      await serviceSupabase.from("moderation_appeal_status_events").delete().eq("appeal_id", appeal.id)
      await serviceSupabase.from("moderation_appeals").delete().eq("id", appeal.id)
      return NextResponse.json({ error: "Failed to write appeal audit log" }, { status: 500 })
    }

    const { error: notificationError } = await serviceSupabase.from("notifications").insert([
      {
        user_id: user.id,
        type: "system",
        title: "Appeal submitted",
        body: "Your appeal has been submitted and is awaiting moderator review.",
        server_id: serverId,
      },
    ])

    if (notificationError) {
      console.warn("Failed appeal notification insert", { appealId: appeal.id, moderatorId: user.id, action: "create", error: notificationError })
      return NextResponse.json({ error: "Failed to create appeal notification" }, { status: 500 })
    }

    return NextResponse.json({
      message: "Appeal submitted",
      trackingId: appeal.id,
      status: appeal.status,
    })

  } catch (err) {
    console.error("[appeals POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
