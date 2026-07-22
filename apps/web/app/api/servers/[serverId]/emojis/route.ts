import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { checkRateLimit } from "@/lib/utils/api-helpers"

const CUSTOM_EMOJI_LIMIT = 50

/** GET /api/servers/[serverId]/emojis — Returns all custom emojis for a server (membership-gated). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = user.id

    // Verify membership before exposing emoji list
    const { data: member } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", userId)
      .maybeSingle()
    if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await supabase
      .from("server_emojis")
      .select("id, name, image_url, created_at, uploader_id, uploader:users!uploader_id(id, display_name, avatar_url)")
      .eq("server_id", serverId)
      .order("name")

    if (error) return NextResponse.json({ error: "Failed to fetch emojis" }, { status: 500 })
    return NextResponse.json(data ?? [], {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    })
  } catch (err) {
    console.error("[servers/emojis GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/servers/[serverId]/emojis — Uploads a new custom emoji (PNG/WebP/GIF, max 256 KB). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limited = await checkRateLimit(user.id, "emojis:upload", { limit: 20, windowMs: 3600_000 })
    if (limited) return limited

    // Verify membership and MANAGE_EMOJIS permission
    const perms = await getMemberPermissions(supabase, serverId, user.id)
    if (!perms.isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!perms.isOwner && !hasPermission(perms.permissions, "MANAGE_EMOJIS")) {
      return NextResponse.json({ error: "You need the Manage Emojis permission to upload emoji" }, { status: 403 })
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const name = (formData.get("name") as string | null)?.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")

    if (!file || !name) return NextResponse.json({ error: "file and name required" }, { status: 400 })
    if (!["image/png", "image/webp", "image/gif"].includes(file.type)) {
      return NextResponse.json({ error: "Only PNG, WebP, and GIF are allowed" }, { status: 415 })
    }
    if (file.size > 256 * 1024) return NextResponse.json({ error: "Emoji must be under 256 KB" }, { status: 413 })

    const { count, error: countError } = await supabase
      .from("server_emojis")
      .select("id", { count: "exact", head: true })
      .eq("server_id", serverId)
    if (countError) return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
    if ((count ?? 0) >= CUSTOM_EMOJI_LIMIT) {
      return NextResponse.json({ error: `Server has reached its ${CUSTOM_EMOJI_LIMIT} custom emoji limit` }, { status: 409 })
    }

    const mimeToExt: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }
    const ext = mimeToExt[file.type] ?? "png"
    const path = `${serverId}/${name}.${ext}`
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from("server-emojis")
      .upload(path, arrayBuffer, { upsert: true, contentType: file.type })

    if (uploadError) return NextResponse.json({ error: "Database operation failed" }, { status: 500 })

    const { data: urlData } = supabase.storage.from("server-emojis").getPublicUrl(path)

    const { data: emoji, error: insertError } = await supabase
      .from("server_emojis")
      .upsert({ server_id: serverId, name, image_url: urlData.publicUrl, uploader_id: user.id }, { onConflict: "server_id,name" })
      .select()
      .single()

    if (insertError || !emoji) {
      await supabase.storage.from("server-emojis").remove([path])
      return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
    }

    // Audit log
    const { error: auditErr } = await supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: user.id,
      action: "emoji_uploaded",
      target_id: emoji.id,
      target_type: "emoji",
      changes: { name },
    })
    if (auditErr) {
      console.error("[emojis] Audit log insert failed for emoji_uploaded", { serverId, emojiId: emoji.id, error: auditErr.message })
    }

    return NextResponse.json(emoji, { status: 201 })
  } catch (err) {
    console.error("[servers/emojis POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE /api/servers/[serverId]/emojis?emojiId=xxx — Removes an emoji (server owner or uploader only). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const emojiId = req.nextUrl.searchParams.get("emojiId")
    if (!emojiId) return NextResponse.json({ error: "emojiId required" }, { status: 400 })

    // Verify membership and permissions
    const perms = await getMemberPermissions(supabase, serverId, user.id)
    if (!perms.isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch the emoji to check ownership and get storage path
    const { data: emoji, error: emojiError } = await supabase
      .from("server_emojis")
      .select("id, name, image_url, uploader_id")
      .eq("id", emojiId)
      .eq("server_id", serverId)
      .maybeSingle()
    if (emojiError) return NextResponse.json({ error: "Failed to load emoji" }, { status: 500 })
    if (!emoji) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Allow owner, uploader, or users with MANAGE_EMOJIS permission
    const isUploader = emoji.uploader_id === user.id
    if (!perms.isOwner && !isUploader && !hasPermission(perms.permissions, "MANAGE_EMOJIS")) {
      return NextResponse.json({ error: "You need the Manage Emojis permission to delete emoji" }, { status: 403 })
    }

    // Use service-role client for storage + DB deletion when the user is just
    // the uploader (they pass the API auth check above but RLS only allows
    // MANAGE_EMOJIS / ADMINISTRATOR, not uploader self-delete).
    const canBypassRls = perms.isOwner || hasPermission(perms.permissions, "MANAGE_EMOJIS")
    const deleteClient = canBypassRls ? supabase : await createServiceRoleClient()

    // Derive storage path from image_url (last two segments: serverId/name.ext)
    const urlParts = emoji.image_url.split("/")
    const storagePath = urlParts.slice(-2).join("/")
    const { error: storageError } = await deleteClient.storage.from("server-emojis").remove([storagePath])
    if (storageError) console.error("Failed to remove emoji from storage:", storageError.message)

    const { error } = await deleteClient
      .from("server_emojis")
      .delete()
      .eq("id", emojiId)
      .eq("server_id", serverId)

    if (error) return NextResponse.json({ error: "Failed to delete emoji" }, { status: 500 })

    // Audit log
    const { error: deleteAuditErr } = await supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: user.id,
      action: "emoji_deleted",
      target_id: emojiId,
      target_type: "emoji",
      changes: { name: emoji.name },
    })
    if (deleteAuditErr) {
      console.error("[emojis] Audit log insert failed for emoji_deleted", { serverId, emojiId, error: deleteAuditErr.message })
    }

    return NextResponse.json({ ok: true }, {
      headers: {
        // Instruct CDN / browser to skip cached copies of the now-deleted asset
        "Cache-Control": "no-cache",
        "CDN-Cache-Control": "no-store, must-revalidate",
      },
    })
  } catch (err) {
    console.error("[servers/emojis DELETE] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
