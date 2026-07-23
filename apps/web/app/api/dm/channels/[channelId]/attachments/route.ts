import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, checkRateLimit } from "@/lib/utils/api-helpers"
import { detectMimeFromBytes, validateFileClient } from "@/lib/attachment-validation"
import { EXECUTABLE_MIMES } from "@/lib/attachment-security-constants"
import { attachmentsDir, writeUploadFile } from "@/lib/storage/local-storage"

/**
 * POST /api/dm/channels/[channelId]/attachments
 *
 * Upload a DM attachment to local disk. Replaces the old flow where the
 * browser uploaded straight to Supabase Storage — local disk can't be
 * written to from the browser, so this route is the new upload boundary.
 * Returns a storage key; the caller still creates the `dm_attachments` row
 * itself once the message that owns it exists.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "dm:attachment-upload", { limit: 30, windowMs: 60_000 })
    if (limited) return limited

    const { data: membership, error: membershipError } = await supabase
      .from("dm_channel_members")
      .select("user_id")
      .eq("dm_channel_id", channelId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
    }
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

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
