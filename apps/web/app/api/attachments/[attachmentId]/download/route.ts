import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import { maybeRenewExpiry } from "@vortex/shared"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
): Promise<NextResponse> {
  const { attachmentId } = await params

  if (!UUID_RE.test(attachmentId)) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
  }

  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError

  try {
    const variant = _request.nextUrl.searchParams.get("variant") // "thumbnail" | "standard"

    const { data: attachment, error } = await supabase
      .from("attachments")
      .select("id, url, message_id, filename, size, expires_at, purged_at, variants")
      .eq("id", attachmentId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: "Failed to fetch attachment" }, { status: 500 })
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    // Block access to purged (expired + deleted from storage) attachments
    if (attachment.purged_at) {
      return NextResponse.json({ error: "This file has expired and is no longer available" }, { status: 410 })
    }

    const { data: message } = await supabase
      .from("messages")
      .select("channel_id")
      .eq("id", attachment.message_id)
      .maybeSingle()

    if (!message) return NextResponse.json({ error: "Attachment not accessible" }, { status: 403 })

    const { data: channel } = await supabase
      .from("channels")
      .select("server_id")
      .eq("id", message.channel_id)
      .maybeSingle()

    if (!channel) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    if (channel.server_id) {
      const { isAdmin, permissions } = await getChannelPermissions(
        supabase,
        channel.server_id,
        message.channel_id,
        user.id,
      )
      if (!isAdmin && !hasPermission(permissions, "VIEW_CHANNELS")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // ── Decay renewal: extend expiry if accessed near deadline ──────────────
    if (attachment.expires_at && attachment.size) {
      const now = new Date()
      const sizeMB = attachment.size / 1024 / 1024
      const renewed = maybeRenewExpiry({
        currentExpiry: new Date(attachment.expires_at),
        now,
        sizeMB,
      })
      // Fire-and-forget: update last_accessed_at (and expires_at if renewed)
      const updatePayload: Record<string, string> = { last_accessed_at: now.toISOString() }
      if (renewed) {
        updatePayload.expires_at = renewed.toISOString()
      }
      supabase
        .from("attachments")
        .update(updatePayload)
        .eq("id", attachment.id)
        .then(() => {}, (err: unknown) => {
          console.error("[attachments/download] renewal update failed", { attachmentId: attachment.id, error: err })
        })
    }

    // Serve a variant if requested (thumbnail or standard)
    if (variant === "thumbnail" || variant === "standard") {
      const variants = attachment.variants as Record<string, { path: string }> | null
      const variantInfo = variants?.[variant]
      if (variantInfo?.path) {
        const { data: variantSigned, error: variantSignError } = await supabase.storage
          .from("attachments")
          .createSignedUrl(variantInfo.path, 3600)
        if (!variantSignError && variantSigned?.signedUrl) {
          return NextResponse.redirect(variantSigned.signedUrl)
        }
        // Fall through to original if variant URL fails
      }
      // Fall through to original if variant not available yet
    }

    // Create a fresh signed URL from the storage path rather than using the
    // stored URL (which may have expired — signed URLs have a 7-day TTL).
    const storagePath = extractStoragePath(attachment.url)
    if (!storagePath) {
      let urlPath: string | null = null
      try {
        urlPath = new URL(attachment.url).pathname
      } catch {
        urlPath = null
      }
      console.error("[attachments/download] failed to extract storage path", {
        route: "/api/attachments/[attachmentId]/download",
        userId: user.id,
        action: "extractStoragePath",
        attachmentId: attachment.id,
        urlPath,
      })
      // Fallback to stored URL to preserve redirect semantics for img/video/audio src consumers
      return NextResponse.redirect(attachment.url)
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from("attachments")
      .createSignedUrl(storagePath, 3600) // 1 hour

    if (signError || !signedData?.signedUrl) {
      console.error("[attachments/download] signed URL creation failed", {
        route: "/api/attachments/[attachmentId]/download",
        userId: user.id,
        action: "createSignedUrl",
        attachmentId: attachment.id,
        storagePath,
        error: signError?.message,
      })
      // Fallback to stored URL to preserve redirect semantics for img/video/audio src consumers
      return NextResponse.redirect(attachment.url)
    }

    return NextResponse.redirect(signedData.signedUrl)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Extract the storage path from a Supabase signed/public URL */
function extractStoragePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Supabase signed URLs: /storage/v1/object/sign/attachments/...
    const signMatch = parsed.pathname.match(/\/(?:storage\/v1\/)?object\/sign\/attachments\/(.+)/)
    if (signMatch?.[1]) return decodeURIComponent(signMatch[1])

    // Supabase public URLs: /storage/v1/object/public/attachments/...
    const pubMatch = parsed.pathname.match(/\/(?:storage\/v1\/)?object\/public\/attachments\/(.+)/)
    if (pubMatch?.[1]) return decodeURIComponent(pubMatch[1])

    // Supabase authenticated URLs: /storage/v1/object/authenticated/attachments/...
    const authMatch = parsed.pathname.match(/\/(?:storage\/v1\/)?object\/authenticated\/attachments\/(.+)/)
    if (authMatch?.[1]) return decodeURIComponent(authMatch[1])

    // Render URLs: /storage/v1/render/image/public/attachments/...
    const renderMatch = parsed.pathname.match(/\/(?:storage\/v1\/)?render\/image\/(?:public|authenticated)\/attachments\/(.+)/)
    if (renderMatch?.[1]) return decodeURIComponent(renderMatch[1])

    return null
  } catch {
    return null
  }
}
