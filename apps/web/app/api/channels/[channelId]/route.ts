import { NextRequest, NextResponse } from "next/server"
import { computePermissions, hasPermission } from "@vortex/shared"
import { requireAuth, parseJsonBody, insertAuditLog } from "@/lib/utils/api-helpers"
import type { Json } from "@/types/database"

// PATCH /api/channels/[channelId] — update channel settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Fetch channel to get server_id
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, server_id, type, name, topic, nsfw, slowmode_delay, forum_guidelines, stream_url")
      .eq("id", channelId)
      .single()

    if (channelError || !channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Permission check: must be server owner or have MANAGE_CHANNELS
    const [serverResult, memberRolesResult, defaultRoleResult] = await Promise.all([
      supabase
        .from("servers")
        .select("owner_id")
        .eq("id", channel.server_id)
        .single(),
      supabase
        .from("member_roles")
        .select("role_id, roles(permissions)")
        .eq("server_id", channel.server_id)
        .eq("user_id", user.id),
      supabase
        .from("roles")
        .select("permissions")
        .eq("server_id", channel.server_id)
        .eq("is_default", true)
        .single(),
    ])

    const server = serverResult.data
    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 })
    }

    const isOwner = server.owner_id === user.id

    if (!isOwner) {
      const memberRoles = memberRolesResult.data
      const defaultRole = defaultRoleResult.data

      const roleBitmasks = [
        ...(memberRoles ?? []).map((r) => (r.roles as unknown as { permissions: number })?.permissions ?? 0),
        defaultRole?.permissions ?? 0,
      ]

      const permissions = computePermissions(roleBitmasks)

      if (!hasPermission(permissions, "MANAGE_CHANNELS")) {
        return NextResponse.json({ error: "Missing MANAGE_CHANNELS permission" }, { status: 403 })
      }
    }

    const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(req)
    if (parseError) return parseError

    // Build the update payload with validation
    const update: Record<string, unknown> = {}

    if (typeof body.name === "string") {
      const name = body.name.trim()
      if (!name || name.length > 100) {
        return NextResponse.json({ error: "Channel name must be 1-100 characters" }, { status: 400 })
      }
      update.name = name
    }

    if (typeof body.topic === "string" || body.topic === null) {
      const topic = typeof body.topic === "string" ? body.topic.trim() : null
      if (topic && topic.length > 1024) {
        return NextResponse.json({ error: "Topic must be 1024 characters or fewer" }, { status: 400 })
      }
      update.topic = topic || null
    }

    if (typeof body.nsfw === "boolean") {
      update.nsfw = body.nsfw
    }

    if (typeof body.slowmode_delay === "number") {
      if (body.slowmode_delay < 0 || body.slowmode_delay > 21600) {
        return NextResponse.json({ error: "Slowmode delay must be 0-21600 seconds" }, { status: 400 })
      }
      update.slowmode_delay = Math.floor(body.slowmode_delay)
    }

    if (typeof body.forum_guidelines === "string" || body.forum_guidelines === null) {
      if (channel.type !== "forum") {
        return NextResponse.json({ error: "Guidelines are only available for forum channels" }, { status: 400 })
      }
      const guidelines = typeof body.forum_guidelines === "string" ? body.forum_guidelines.trim() : null
      if (guidelines && guidelines.length > 2000) {
        return NextResponse.json({ error: "Guidelines must be 2000 characters or fewer" }, { status: 400 })
      }
      update.forum_guidelines = guidelines || null
    }

    if (typeof body.stream_url === "string" || body.stream_url === null) {
      if (channel.type !== "stage") {
        return NextResponse.json({ error: "Stream URL is only available for stage channels" }, { status: 400 })
      }
      const streamUrl = typeof body.stream_url === "string" ? body.stream_url.trim() : null
      if (streamUrl && streamUrl.length > 2048) {
        return NextResponse.json({ error: "Stream URL must be 2048 characters or fewer" }, { status: 400 })
      }
      if (streamUrl) {
        let parsed: URL
        try {
          parsed = new URL(streamUrl)
        } catch {
          return NextResponse.json({ error: "Stream URL must be a valid URL" }, { status: 400 })
        }
        const host = parsed.hostname.replace(/^www\./, "")
        const isYouTubeHost = host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be"
        if (!isYouTubeHost) {
          return NextResponse.json({ error: "Only YouTube URLs are currently supported" }, { status: 400 })
        }
      }
      update.stream_url = streamUrl || null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data: updated, error: updateError } = await supabase
      .from("channels")
      .update(update)
      .eq("id", channelId)
      .select("id, server_id, name, type, topic, position, parent_id, slowmode_delay, nsfw, forum_guidelines, stream_url")
      .single()

    if (updateError || !updated) {
      console.error("[channels/[channelId] PATCH] update error:", { channelId, userId: user.id, error: updateError?.message ?? "No row returned" })
      return NextResponse.json({ error: "Failed to update channel" }, { status: 500 })
    }

    // Build before/after diff for audit log
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    for (const key of Object.keys(update)) {
      changes[key] = {
        old: channel[key as keyof typeof channel],
        new: updated[key as keyof typeof updated],
      }
    }

    await insertAuditLog(supabase, {
      server_id: channel.server_id,
      actor_id: user.id,
      action: "channel_updated",
      target_id: channelId,
      target_type: "channel",
      changes: changes as Record<string, Json | undefined>,
    })

    return NextResponse.json(updated)

  } catch (err) {
    console.error("[channels/[channelId] PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
