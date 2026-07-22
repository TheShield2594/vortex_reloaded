import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { untypedFrom } from "@/lib/supabase/untyped-table"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

/**
 * GET /api/cron/attachment-decay
 *
 * Purge worker: deletes expired attachment files from Supabase Storage
 * and marks the database rows as purged. Processes both channel attachments
 * and DM attachments in batches.
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

    const serviceClient = await createServiceRoleClient()
    const now = new Date().toISOString()
    const BATCH_LIMIT = 200

    // ── Purge expired channel attachments ────────────────────────────────────

    const { data: expiredAttachments } = await serviceClient
      .from("attachments")
      .select("id, url, filename, size, message_id")
      .lt("expires_at", now)
      .is("purged_at", null)
      .not("expires_at", "is", null)
      .limit(BATCH_LIMIT)

    let purgedChannel = 0
    let storageErrors = 0

    for (const att of expiredAttachments ?? []) {
      const storagePath = extractStoragePath(att.url)
      if (!storagePath) {
        console.warn("[cron/attachment-decay] could not extract storage path, skipping", {
          attachmentId: att.id,
          url: att.url,
        })
        storageErrors++
        continue
      }

      const { error: removeError } = await serviceClient.storage
        .from("attachments")
        .remove([storagePath])

      if (removeError) {
        console.error("[cron/attachment-decay] storage remove failed", {
          attachmentId: att.id,
          path: storagePath,
          error: removeError.message,
        })
        storageErrors++
        // Still mark as purged — the file may already be gone
      }

      await serviceClient
        .from("attachments")
        .update({ purged_at: now })
        .eq("id", att.id)

      purgedChannel++
    }

    // ── Purge expired DM attachments ─────────────────────────────────────────

    // dm_attachments is not in generated Supabase types yet
    type DmAttRow = { id: string; url: string; filename: string; size: number; dm_id: string }
    const { data: expiredDmAttachments, error: dmQueryError } = await untypedFrom(serviceClient, "dm_attachments")
      .select("id, url, filename, size, dm_id")
      .lt("expires_at", now)
      .is("purged_at", null)
      .not("expires_at", "is", null)
      .limit(BATCH_LIMIT) as { data: DmAttRow[] | null; error: { message: string } | null }

    if (dmQueryError) {
      console.error("[cron/attachment-decay] dm query failed", { error: dmQueryError.message })
    }

    let purgedDm = 0

    for (const att of expiredDmAttachments ?? []) {
      const storagePath = extractStoragePath(att.url)
      if (!storagePath) {
        console.warn("[cron/attachment-decay] could not extract DM storage path, skipping", {
          attachmentId: att.id,
          url: att.url,
        })
        storageErrors++
        continue
      }

      const { error: removeError } = await serviceClient.storage
        .from("attachments")
        .remove([storagePath])

      if (removeError) {
        console.error("[cron/attachment-decay] dm storage remove failed", {
          attachmentId: att.id,
          path: storagePath,
          error: removeError.message,
        })
        storageErrors++
        // Still mark as purged — the file may already be gone
      }

      const { error: updateError } = await untypedFrom(serviceClient, "dm_attachments")
        .update({ purged_at: now })
        .eq("id", att.id)

      if (updateError) {
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

/** Extract the storage path from a Supabase signed/public URL */
function extractStoragePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    const signMatch = parsed.pathname.match(
      /\/(?:storage\/v1\/)?object\/sign\/attachments\/(.+)/
    )
    if (signMatch?.[1]) return decodeURIComponent(signMatch[1])

    const pubMatch = parsed.pathname.match(
      /\/(?:storage\/v1\/)?object\/public\/attachments\/(.+)/
    )
    if (pubMatch?.[1]) return decodeURIComponent(pubMatch[1])

    return null
  } catch {
    return null
  }
}
