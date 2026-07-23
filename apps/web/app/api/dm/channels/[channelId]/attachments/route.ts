import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { eq, and } from "drizzle-orm"
import { createDb, dmAttachments, dmChannelMembers, directMessages } from "@vortex/db"
import { requireAuth, checkRateLimit } from "@/lib/utils/api-helpers"
import { detectMimeFromBytes, validateFileClient } from "@/lib/attachment-validation"
import { EXECUTABLE_MIMES } from "@/lib/attachment-security-constants"
import { attachmentsDir, deleteUploadFile, writeUploadFile } from "@/lib/storage/local-storage"
import { computeDecay } from "@vortex/shared"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

async function verifyMembership(channelId: string, userId: string): Promise<NextResponse | null> {
  try {
    const rows = await db
      .select({ userId: dmChannelMembers.userId })
      .from(dmChannelMembers)
      .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, userId)))
      .limit(1)
    if (!rows[0]) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    return null
  } catch {
    return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
  }
}

/**
 * POST /api/dm/channels/[channelId]/attachments
 *
 * Upload a DM attachment to local disk. Replaces the old flow where the
 * browser uploaded straight to Supabase Storage — local disk can't be
 * written to from the browser, so this route is the new upload boundary.
 * Returns a storage key; the caller still creates the `dm_attachments` row
 * itself once the message that owns it exists (see the PATCH handler below).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "dm:attachment-upload", { limit: 30, windowMs: 60_000 })
    if (limited) return limited

    const membershipError = await verifyMembership(channelId, user.id)
    if (membershipError) return membershipError

    const contentType = req.headers.get("content-type") ?? ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Request must be multipart/form-data" }, { status: 400 })
    }

    const formData = await req.formData()
    const fileVal = formData.get("file")
    if (!(fileVal instanceof File) || fileVal.size === 0) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 })
    }

    const clientError = validateFileClient(fileVal)
    if (clientError) return NextResponse.json({ error: clientError }, { status: 400 })

    const headerBytes = new Uint8Array(await fileVal.slice(0, 16).arrayBuffer())
    const detectedMime = detectMimeFromBytes(headerBytes)
    if (detectedMime && EXECUTABLE_MIMES.has(detectedMime)) {
      return NextResponse.json({ error: "File appears to be an executable and has been rejected for safety." }, { status: 400 })
    }

    const ext = fileVal.name.split(".").pop() || "bin"
    const key = `dm-attachments/${channelId}/${randomUUID()}.${ext}`

    try {
      const bytes = Buffer.from(await fileVal.arrayBuffer())
      await writeUploadFile(attachmentsDir(), key, bytes)
    } catch {
      return NextResponse.json({ error: "File upload failed" }, { status: 500 })
    }

    return NextResponse.json({
      key,
      filename: fileVal.name,
      size: fileVal.size,
      content_type: fileVal.type || detectedMime || "application/octet-stream",
    })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * DELETE /api/dm/channels/[channelId]/attachments?key=...
 *
 * Best-effort cleanup for a file this route just uploaded when the message
 * that was supposed to reference it never ends up created (e.g. sendDmPayload
 * or the dm_attachments insert fails afterward) — otherwise it's an orphan
 * that nothing ever purges.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const membershipError = await verifyMembership(channelId, user.id)
    if (membershipError) return membershipError

    const key = req.nextUrl.searchParams.get("key")
    if (!key || !key.startsWith(`dm-attachments/${channelId}/`)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 })
    }

    // Refuse to delete a file that's already attached to a message — this
    // endpoint is only for cleaning up an upload that never got attached.
    let existing: { id: string } | undefined
    try {
      const rows = await db.select({ id: dmAttachments.id }).from(dmAttachments).where(eq(dmAttachments.url, key)).limit(1)
      existing = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to check attachment state" }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json({ error: "Cannot delete an attached file" }, { status: 409 })
    }

    await deleteUploadFile(attachmentsDir(), key)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH /api/dm/channels/[channelId]/attachments
 *
 * Persist the `dm_attachments` metadata row for a file the POST handler
 * above already wrote to disk, once the message that owns it exists. This
 * used to be a browser-side Supabase insert (RLS-gated to the message's
 * sender) — SQLite has no RLS, so the same ownership check now runs here
 * instead, server-side, before the row is written.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }): Promise<NextResponse> {
  try {
    const { channelId } = await params
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const membershipError = await verifyMembership(channelId, user.id)
    if (membershipError) return membershipError

    const body = await req.json().catch(() => null)
    const dmId = typeof body?.dm_id === "string" ? body.dm_id : null
    const key = typeof body?.key === "string" ? body.key : null
    const filename = typeof body?.filename === "string" ? body.filename : null
    const size = typeof body?.size === "number" ? body.size : null
    const contentType = typeof body?.content_type === "string" ? body.content_type : null
    if (!dmId || !key || !filename || size === null || !contentType) {
      return NextResponse.json({ error: "dm_id, key, filename, size, content_type required" }, { status: 400 })
    }
    if (!key.startsWith(`dm-attachments/${channelId}/`)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 })
    }

    // The message must exist, belong to this channel, and have been sent by
    // the caller — otherwise anyone in the channel could attach a file to
    // someone else's message.
    let message: { id: string } | undefined
    try {
      const rows = await db
        .select({ id: directMessages.id })
        .from(directMessages)
        .where(
          and(
            eq(directMessages.id, dmId),
            eq(directMessages.dmChannelId, channelId),
            eq(directMessages.senderId, user.id)
          )
        )
        .limit(1)
      message = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to verify message" }, { status: 500 })
    }
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const now = new Date()
    const decay = computeDecay({ sizeBytes: size, uploadedAt: now })

    let inserted: typeof dmAttachments.$inferSelect
    try {
      const [row] = await db
        .insert(dmAttachments)
        .values({
          dmId,
          url: key,
          filename,
          size,
          contentType,
          ...(decay
            ? {
                expiresAt: decay.expiresAt.toISOString(),
                lastAccessedAt: now.toISOString(),
                lifetimeDays: decay.days,
                decayCost: decay.cost,
              }
            : {}),
        })
        .returning()
      if (!row) throw new Error("insert returned no row")
      inserted = row
    } catch {
      return NextResponse.json({ error: "Failed to save attachment metadata" }, { status: 500 })
    }

    return NextResponse.json(
      toSnakeCase({ id: inserted.id, filename: inserted.filename, size: inserted.size, contentType: inserted.contentType })
    )
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
