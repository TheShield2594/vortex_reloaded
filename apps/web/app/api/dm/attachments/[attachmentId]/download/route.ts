import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import { maybeRenewExpiry } from "@vortex/shared"
import { untypedFrom } from "@/lib/supabase/untyped-table"
import { attachmentsDir, statUploadFile } from "@/lib/storage/local-storage"

/** Parsed byte range for a single-range `Range: bytes=...` request. */
interface ByteRange {
  start: number
  end: number
}

/**
 * Parses a `Range` header against a known file size.
 * Returns `undefined` for no/absent header (serve the full file), `null` for
 * a present-but-unsatisfiable range (caller should respond 416), or the
 * resolved inclusive [start, end] byte range otherwise. Only single-range
 * requests are supported (`bytes=start-end`, `bytes=start-`, `bytes=-suffix`) —
 * multi-range requests fall back to the full file, which is spec-compliant
 * (a server may ignore Range entirely).
 */
function parseRange(rangeHeader: string | null, size: number): ByteRange | null | undefined {
  if (!rangeHeader) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match || (!match[1] && !match[2])) return undefined

  let start: number
  let end: number
  if (match[1]) {
    start = parseInt(match[1], 10)
    end = match[2] ? parseInt(match[2], 10) : size - 1
  } else {
    const suffixLength = parseInt(match[2], 10)
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || start >= size) {
    return null
  }

  return { start, end: Math.min(end, size - 1) }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
): Promise<NextResponse> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  try {
    const { attachmentId } = await params

    if (!UUID_RE.test(attachmentId)) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
    }

    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // dm_attachments table is not yet in generated Supabase types
    const { data: attachment, error } = await untypedFrom(supabase, "dm_attachments")
      .select("id, url, dm_id, filename, content_type, size, expires_at, purged_at")
      .eq("id", attachmentId)
      .maybeSingle() as { data: { id: string; url: string; dm_id: string; filename: string; content_type: string; size: number; expires_at: string | null; purged_at: string | null } | null; error: unknown }

    if (error) {
      console.error("dm-attachments/download: fetch failed", { userId: user.id, attachmentId, error: String(error) })
      return NextResponse.json({ error: "Failed to fetch attachment" }, { status: 500 })
    }
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    // Block access to purged (expired + deleted from storage) attachments
    if (attachment.purged_at) {
      return NextResponse.json({ error: "This file has expired and is no longer available" }, { status: 410 })
    }

    // Get the DM to find the channel
    const { data: dm, error: dmError } = await supabase
      .from("direct_messages")
      .select("dm_channel_id")
      .eq("id", attachment.dm_id)
      .maybeSingle()

    if (dmError) {
      console.error("dm-attachments/download: DM lookup failed", { userId: user.id, attachmentId, error: dmError.message })
      return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 })
    }
    if (!dm?.dm_channel_id) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    // Verify the user is a member of this DM channel
    const { data: membership, error: membershipError } = await supabase
      .from("dm_channel_members")
      .select("user_id")
      .eq("dm_channel_id", dm.dm_channel_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) {
      console.error("dm-attachments/download: membership check failed", { userId: user.id, attachmentId, error: membershipError.message })
      return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
    }
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // ── Decay renewal: extend expiry if accessed near deadline ──────────────
    if (attachment.expires_at && attachment.size) {
      const now = new Date()
      const sizeMB = attachment.size / 1024 / 1024
      const renewed = maybeRenewExpiry({
        currentExpiry: new Date(attachment.expires_at),
        now,
        sizeMB,
      })
      const updatePayload: Record<string, string> = { last_accessed_at: now.toISOString() }
      if (renewed) {
        updatePayload.expires_at = renewed.toISOString()
      }
      // Fire-and-forget update
      ;untypedFrom(supabase, "dm_attachments")
        .update(updatePayload)
        .eq("id", attachment.id)
        .then(() => {}, (err: unknown) => {
          console.error("[dm-attachments/download] renewal update failed", { attachmentId: attachment.id, error: err })
        })
    }

    // attachment.url is a local storage key (relative path under the
    // attachments upload dir), not an external URL — this route is now the
    // access-control boundary AND the thing that serves the bytes.
    const file = await statUploadFile(attachmentsDir(), attachment.url)
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    // Range support: <video>/<audio> elements rely on 206 partial responses
    // to seek — the old Supabase-signed-URL redirect got this for free from
    // Supabase's CDN, so serving the bytes directly needs to replicate it.
    const range = parseRange(request.headers.get("range"), file.size)
    if (range === null) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${file.size}`,
          "Accept-Ranges": "bytes",
        },
      })
    }

    const baseHeaders: Record<string, string> = {
      "Content-Type": attachment.content_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.filename)}"`,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    }

    if (range) {
      const { start, end } = range
      const stream = Readable.toWeb(createReadStream(file.path, { start, end })) as ReadableStream
      return new NextResponse(stream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${file.size}`,
          "Content-Length": String(end - start + 1),
        },
      })
    }

    const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream
    return new NextResponse(stream, {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(file.size),
      },
    })
  } catch (err) {
    console.error("dm-attachments/download: unexpected error", { error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
