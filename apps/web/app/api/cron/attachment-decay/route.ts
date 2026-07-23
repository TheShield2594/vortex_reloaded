import * as Sentry from "@sentry/nextjs"
import { NextRequest, NextResponse } from "next/server"
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm"
import { attachments, createDb, dmAttachments } from "@vortex/db"
import { verifyBearerToken } from "@/lib/utils/timing-safe"
import { attachmentsDir, deleteUploadFile } from "@/lib/storage/local-storage"

const db = createDb()

// deleteUploadFile() already treats a missing file as success, so anything
// landing here is a genuinely unexpected failure (permission/disk issues) —
// a small threshold avoids paging on a single rare blip while still
// catching a systemic problem.
const STORAGE_ERROR_ALERT_THRESHOLD = 5

/**
 * GET /api/cron/attachment-decay
 *
 * Purge worker: deletes expired attachment files from local disk and marks
 * the database rows as purged. Processes both channel attachments and DM
 * attachments in batches.
 *
 * Called daily by scheduled-tasks cron dispatcher. Also available for
 * manual invocation. Requires CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const authHeader = req.headers.get("authorization")
    if (!verifyBearerToken(authHeader, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date().toISOString()
    const BATCH_LIMIT = 200

    // ── Purge expired channel attachments ────────────────────────────────────

    const expiredAttachments = await db
      .select({ id: attachments.id, url: attachments.url })
      .from(attachments)
      .where(
        and(
          isNotNull(attachments.expiresAt),
          lt(attachments.expiresAt, now),
          isNull(attachments.purgedAt)
        )
      )
      .limit(BATCH_LIMIT)

    let purgedChannel = 0
    let storageErrors = 0

    for (const att of expiredAttachments) {
      try {
        await deleteUploadFile(attachmentsDir(), att.url)
      } catch (removeError) {
        console.error("[cron/attachment-decay] storage remove failed", {
          attachmentId: att.id,
          path: att.url,
          error: removeError instanceof Error ? removeError.message : String(removeError),
        })
        storageErrors++
        // Still mark as purged — the file may already be gone
      }

      try {
        await db.update(attachments).set({ purgedAt: now }).where(eq(attachments.id, att.id))
      } catch (updateError) {
        console.error("[cron/attachment-decay] update failed", { attachmentId: att.id, error: updateError })
        storageErrors++
        continue
      }

      purgedChannel++
    }

    // ── Purge expired DM attachments ─────────────────────────────────────────

    const expiredDmAttachments = await db
      .select({ id: dmAttachments.id, url: dmAttachments.url })
      .from(dmAttachments)
      .where(
        and(
          isNotNull(dmAttachments.expiresAt),
          lt(dmAttachments.expiresAt, now),
          isNull(dmAttachments.purgedAt)
        )
      )
      .limit(BATCH_LIMIT)

    let purgedDm = 0

    for (const att of expiredDmAttachments) {
      try {
        await deleteUploadFile(attachmentsDir(), att.url)
      } catch (removeError) {
        console.error("[cron/attachment-decay] dm storage remove failed", {
          attachmentId: att.id,
          path: att.url,
          error: removeError instanceof Error ? removeError.message : String(removeError),
        })
        storageErrors++
        // Still mark as purged — the file may already be gone
      }

      try {
        await db.update(dmAttachments).set({ purgedAt: now }).where(eq(dmAttachments.id, att.id))
      } catch (updateError) {
        console.error("[cron/attachment-decay] dm update failed", { attachmentId: att.id, error: updateError })
        storageErrors++
        continue
      }

      purgedDm++
    }

    console.log("[cron/attachment-decay] run complete", {
      purgedChannel,
      purgedDm,
      storageErrors,
      runAt: now,
    })

    if (storageErrors >= STORAGE_ERROR_ALERT_THRESHOLD) {
      Sentry.captureMessage(`attachment-decay: ${storageErrors} storage error(s) during purge run`, {
        level: "error",
        extra: { purgedChannel, purgedDm, storageErrors, runAt: now },
      })
    }

    return NextResponse.json({
      ok: true,
      purgedChannel,
      purgedDm,
      storageErrors,
      runAt: now,
    })
  } catch (err) {
    console.error("[cron/attachment-decay] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
