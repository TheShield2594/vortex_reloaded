import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import { maybeRenewExpiry } from "@vortex/shared"
import { untypedFrom } from "@/lib/supabase/untyped-table"

export async function GET(
  _request: NextRequest,
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

    // Extract the storage path from the URL and create a fresh signed URL
    const storagePath = extractStoragePath(attachment.url)
    if (!storagePath) {
      return NextResponse.json({ error: "Invalid attachment URL" }, { status: 400 })
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from("attachments")
      .createSignedUrl(storagePath, 3600) // 1 hour expiry

    if (signError || !signedData?.signedUrl) {
      console.error("dm-attachments/download: signing failed", { userId: user.id, attachmentId, error: signError?.message })
      return NextResponse.json({ error: "Failed to generate signed URL" }, { status: 500 })
    }

    return NextResponse.redirect(signedData.signedUrl)
  } catch (err) {
    console.error("dm-attachments/download: unexpected error", { error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Extract the storage path from a Supabase storage URL */
function extractStoragePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Supabase storage URLs contain /object/public/bucketname/ or /object/sign/bucketname/
    const match = parsed.pathname.match(/\/object\/(?:public|sign)\/attachments\/(.+)/)
    if (match?.[1]) return decodeURIComponent(match[1])

    // Also handle /storage/v1/object/ pattern
    const altMatch = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/attachments\/(.+)/)
    if (altMatch?.[1]) return decodeURIComponent(altMatch[1])

    return null
  } catch {
    return null
  }
}
