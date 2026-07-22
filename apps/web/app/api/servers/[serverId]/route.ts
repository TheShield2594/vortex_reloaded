import { NextRequest, NextResponse } from "next/server"
import { hasPermission } from "@vortex/shared"
import { aggregateMemberPermissions } from "@/lib/server-auth"
import { detectMimeFromBytes } from "@/lib/attachment-validation"
import { requireAuth, insertAuditLog } from "@/lib/utils/api-helpers"
import type { Json } from "@/types/database"

type Params = { params: Promise<{ serverId: string }> }

/**
 * PATCH /api/servers/[serverId]
 *
 * Editable fields: name, icon (via multipart form), description
 * Permission: server owner OR ADMINISTRATOR
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data: server } = await supabase
      .from("servers")
      .select("owner_id, name, description, icon_url")
      .eq("id", serverId)
      .single()

    if (!server)
      return NextResponse.json({ error: "Server not found" }, { status: 404 })

    const isOwner = server.owner_id === user.id

    if (!isOwner) {
      // Check for ADMINISTRATOR permission
      const { data: memberRoles } = await supabase
        .from("member_roles")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .eq("server_id", serverId)

      const permissions = aggregateMemberPermissions(memberRoles)
      if (!hasPermission(permissions, "ADMINISTRATOR"))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const contentType = req.headers.get("content-type") ?? ""
    const isMultipart = contentType.includes("multipart/form-data")

    let name: string | undefined
    let description: string | undefined
    let vanityUrl: string | undefined | null
    let regenerateInvite = false
    let iconFile: File | null = null

    if (isMultipart) {
      const formData = await req.formData()
      const nameVal = formData.get("name")
      const descVal = formData.get("description")
      const iconVal = formData.get("icon")
      const vanityVal = formData.get("vanity_url")

      if (nameVal !== null) name = String(nameVal)
      if (descVal !== null) description = String(descVal)
      if (vanityVal !== null) vanityUrl = String(vanityVal) || null
      if (iconVal instanceof File && iconVal.size > 0) iconFile = iconVal
      if (formData.get("regenerate_invite") === "true") regenerateInvite = true
    } else {
      const raw = await req.json().catch(() => ({}))
      const body = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}
      if ("name" in body) name = String(body.name)
      if ("description" in body) description = String(body.description)
      if ("vanity_url" in body) vanityUrl = body.vanity_url === null ? null : String(body.vanity_url)
      if (body.regenerate_invite === true) regenerateInvite = true
    }

    const updates: Record<string, unknown> = {}
    const changes: Record<string, Json | undefined> = {}

    // Validate name
    if (name !== undefined) {
      const trimmed = name.trim()
      if (trimmed.length < 1 || trimmed.length > 100) {
        return NextResponse.json({ error: "name must be 1–100 characters" }, { status: 400 })
      }
      updates.name = trimmed
      changes.name = { old: server.name, new: trimmed }
    }

    // Validate description
    if (description !== undefined) {
      const trimmed = description.trim()
      if (trimmed.length > 1024) {
        return NextResponse.json({ error: "description must be 0–1024 characters" }, { status: 400 })
      }
      updates.description = trimmed || null
      changes.description = { old: server.description, new: trimmed || null }
    }

    // Validate vanity URL
    if (vanityUrl !== undefined) {
      if (!isOwner) {
        return NextResponse.json({ error: "Only the server owner can set a vanity URL" }, { status: 403 })
      }
      if (vanityUrl === null) {
        // Clearing vanity URL
        updates.vanity_url = null
        changes.vanity_url = { old: "[redacted]", new: null }
      } else {
        const slug = vanityUrl.toLowerCase().trim()
        if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
          return NextResponse.json(
            { error: "Vanity URL must be 3-32 characters, lowercase alphanumeric and hyphens only, no leading/trailing hyphens" },
            { status: 400 }
          )
        }
        // Check uniqueness
        const { data: existing } = await supabase
          .from("servers")
          .select("id")
          .eq("vanity_url", slug)
          .neq("id", serverId)
          .maybeSingle()
        if (existing) {
          return NextResponse.json({ error: "This vanity URL is already taken" }, { status: 409 })
        }
        updates.vanity_url = slug
        changes.vanity_url = { old: "[redacted]", new: slug }
      }
    }

    // Check invite regeneration permission before any side effects
    if (regenerateInvite && !isOwner) {
      await insertAuditLog(supabase, {
        server_id: serverId,
        actor_id: user.id,
        action: "invite_regenerate_denied",
        target_id: serverId,
        target_type: "server",
        changes: {},
      })
      return NextResponse.json({ error: "Only the server owner can regenerate the invite code" }, { status: 403 })
    }

    // Handle icon upload
    if (iconFile) {
      const ALLOWED_ICON_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
      const ALLOWED_ICON_EXTS = ["png", "jpg", "jpeg", "gif", "webp"]
      const MAX_ICON_SIZE = 2 * 1024 * 1024 // 2 MB

      if (!ALLOWED_ICON_TYPES.includes(iconFile.type)) {
        return NextResponse.json({ error: "Icon must be PNG, JPEG, GIF, or WebP" }, { status: 400 })
      }
      const rawExt = (iconFile.name.split(".").pop() ?? "").toLowerCase()
      if (!ALLOWED_ICON_EXTS.includes(rawExt)) {
        return NextResponse.json({ error: "Icon file extension not allowed" }, { status: 400 })
      }
      if (iconFile.size > MAX_ICON_SIZE) {
        return NextResponse.json({ error: "Icon must be 2 MB or smaller" }, { status: 400 })
      }

      // Verify magic bytes match claimed type
      const headerSlice = iconFile.slice(0, 16)
      const headerBytes = new Uint8Array(await headerSlice.arrayBuffer())
      const detectedMime = detectMimeFromBytes(headerBytes)
      if (detectedMime && !ALLOWED_ICON_TYPES.includes(detectedMime)) {
        return NextResponse.json({ error: "Icon file content does not match an allowed image type" }, { status: 400 })
      }

      const ext = rawExt || "png"
      const path = `${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("server-icons")
        .upload(path, iconFile, { upsert: true })

      if (uploadError) {
        console.error("[servers/[serverId] PATCH] icon upload error:", uploadError.message)
        return NextResponse.json({ error: "Icon upload failed" }, { status: 500 })
      }

      const { data: urlData } = supabase.storage
        .from("server-icons")
        .getPublicUrl(path)

      // Delete old icon from storage if one exists
      if (server.icon_url) {
        try {
          const url = new URL(server.icon_url)
          const oldPath = url.pathname.split("/server-icons/").pop()
          if (oldPath) {
            await supabase.storage.from("server-icons").remove([oldPath])
          }
        } catch {
          // Ignore cleanup errors — old file may already be gone
        }
      }

      updates.icon_url = urlData.publicUrl
      changes.icon_url = { old: server.icon_url, new: urlData.publicUrl }
    }

    // Handle invite code regeneration (owner check already done above)
    if (regenerateInvite) {
      const newCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      updates.invite_code = newCode
      changes.invite_code = { old: "[redacted]", new: "[redacted]" }
    }

    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })

    const { data: updated, error: dbErr } = await supabase
      .from("servers")
      .update(updates)
      .eq("id", serverId)
      .select()
      .single()

    if (dbErr) {
      if (dbErr.code === "23505") {
        return NextResponse.json({ error: "This vanity URL is already taken" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to update server" }, { status: 500 })
    }

    // Audit log
    await insertAuditLog(supabase, {
      server_id: serverId,
      actor_id: user.id,
      action: "server_update",
      target_id: serverId,
      target_type: "server",
      changes,
    })

    return NextResponse.json(updated)

  } catch (err) {
    console.error("[servers/[serverId] PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/servers/[serverId]
 *
 * Deletes the server and all associated data (channels, messages, roles, etc.).
 * Permission: server owner only
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  let serverId: string | undefined
  let userId: string | undefined
  try {
    ({ serverId } = await params)
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError
    userId = user.id

    const { data: server } = await supabase
      .from("servers")
      .select("owner_id, name")
      .eq("id", serverId)
      .single()

    if (!server)
      return NextResponse.json({ error: "Server not found" }, { status: 404 })

    if (server.owner_id !== user.id) {
      await insertAuditLog(supabase, {
        server_id: serverId,
        actor_id: user.id,
        action: "server_delete_denied",
        target_id: serverId,
        target_type: "server",
        changes: {},
      })
      return NextResponse.json({ error: "Only the server owner can delete the server" }, { status: 403 })
    }

    // Write audit log BEFORE deletion while server_id FK is still valid
    await insertAuditLog(supabase, {
      server_id: serverId,
      actor_id: user.id,
      action: "server_delete",
      target_id: serverId,
      target_type: "server",
      changes: { name: { old: server.name, new: null } },
    })

    // Atomic cascade deletion via stored procedure — either everything
    // is removed in a single transaction or nothing is.
    const { error: rpcError } = await supabase.rpc("delete_server_cascade", {
      p_server_id: serverId,
    })

    if (rpcError) {
      console.error("[servers DELETE] RPC failed", { serverId, error: rpcError.message })
      return NextResponse.json({ error: "Failed to delete server" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[servers DELETE] unhandled error", {
      action: "server_delete",
      serverId,
      userId,
      err,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
