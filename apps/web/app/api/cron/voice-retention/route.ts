import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { writeAuditEvent } from "@/lib/voice/vortex-recap-service"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

/**
 * GET /api/cron/voice-retention
 *
 * Purge worker: hard-deletes expired voice transcript segments and summaries
 * that are past their expires_at and have not been purged yet.
 * Legal-hold records are explicitly skipped and logged.
 *
 * Called by a scheduled cron job (e.g. Vercel Cron). Requires CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  try {
    // Fail closed: reject all requests when CRON_SECRET is not configured
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const authHeader = req.headers.get("authorization")
    if (!verifyBearerToken(authHeader, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const serviceClient = await createServiceRoleClient()
    const now = new Date().toISOString()

    // ── Purge expired transcript segments (skip legal holds) ──────────────────

    const { data: expiredSegments } = await serviceClient
      .from("voice_transcript_segments")
      .select("id, session_id, legal_hold")
      .lt("expires_at", now)
      .is("purged_at", null)
      .limit(500)

    let purgedSegments = 0
    let skippedSegmentsHeld = 0

    for (const seg of expiredSegments ?? []) {
      if (seg.legal_hold) {
        skippedSegmentsHeld++
        continue
      }

      await serviceClient
        .from("voice_transcript_segments")
        .update({ purged_at: now })
        .eq("id", seg.id)

      purgedSegments++
    }

    // Write purge audit event for segments
    if (purgedSegments > 0) {
      await writeAuditEvent(serviceClient, null, null, "voice_segments_purged", {
        count: purgedSegments,
        skipped_held: skippedSegmentsHeld,
        run_at: now,
      })
    }

    // ── Purge expired summaries (skip legal holds) ────────────────────────────

    const { data: expiredSummaries } = await serviceClient
      .from("voice_call_summaries")
      .select("session_id, legal_hold")
      .lt("expires_at", now)
      .is("purged_at", null)
      .limit(500)

    let purgedSummaries = 0
    let skippedSummariesHeld = 0

    for (const sum of expiredSummaries ?? []) {
      if (sum.legal_hold) {
        skippedSummariesHeld++
        continue
      }

      await serviceClient
        .from("voice_call_summaries")
        .update({ purged_at: now })
        .eq("session_id", sum.session_id)

      purgedSummaries++
    }

    if (purgedSummaries > 0) {
      await writeAuditEvent(serviceClient, null, null, "voice_summaries_purged", {
        count: purgedSummaries,
        skipped_held: skippedSummariesHeld,
        run_at: now,
      })
    }

    return NextResponse.json({
      ok: true,
      purgedSegments,
      skippedSegmentsHeld,
      purgedSummaries,
      skippedSummariesHeld,
      runAt: now,
    })

  } catch (err) {
    console.error("[cron/voice-retention GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
