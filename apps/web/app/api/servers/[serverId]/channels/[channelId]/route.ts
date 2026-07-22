import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { invalidate, invalidatePrefix } from "@/lib/server-cache"
import type { Json } from "@/types/database"

type Params = { params: Promise<{ serverId: string; channelId: string }> }

const MAX_SLOWMODE_SECONDS = 21600

/**
 * PATCH /api/servers/[serverId]/channels/[channelId]
 *
 * Editable fields: name, topic, nsfw, slowmode_delay, stream_url (stage-only)
 * Requires MANAGE_CHANNELS permission.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  let serverId: string | undefined
  let channelId: string | undefined
  let userId: string | undefined
  try {
  ({ serverId, channelId } = await params)
  const { supabase, user, error } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
  if (error) return error
  userId = user?.id

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Verify the channel belongs to this server
  const { data: channel } = await supabase
    .from("channels")
    .select("id, server_id, type, name, topic, nsfw, slowmode_delay, stream_url")
    .eq("id", channelId)
    .eq("server_id", serverId)
    .single()

  if (!channel)
    return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  const updates: Record<string, unknown> = {}
  const changes: Record<string, { old: unknown; new: unknown }> = {}

  // Validate name
  if ("name" in body) {
    const name = body.name
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
      return NextResponse.json({ error: "name must be 1–100 characters" }, { status: 400 })
    }
    const sanitized = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    if (sanitized.length < 1) {
      return NextResponse.json({ error: "name must contain at least one valid character" }, { status: 400 })
    }
    updates.name = sanitized
    changes.name = { old: channel.name, new: sanitized }
  }

  // Validate topic
  if ("topic" in body) {
    const topic = body.topic
    if (topic !== null && (typeof topic !== "string" || topic.length > 1024)) {
      return NextResponse.json({ error: "topic must be a string of 0–1024 characters or null" }, { status: 400 })
    }
    const sanitized = typeof topic === "string" ? (topic.trim() || null) : null
    updates.topic = sanitized
    changes.topic = { old: channel.topic, new: sanitized }
  }

  // Validate nsfw
  if ("nsfw" in body) {
    const nsfw = body.nsfw
    if (typeof nsfw !== "boolean") {
      return NextResponse.json({ error: "nsfw must be a boolean" }, { status: 400 })
    }
    updates.nsfw = nsfw
    changes.nsfw = { old: channel.nsfw, new: nsfw }
  }

  // Validate slowmode_delay
  if ("slowmode_delay" in body) {
    const slowmode = body.slowmode_delay
    if (typeof slowmode !== "number" || !Number.isInteger(slowmode) || slowmode < 0 || slowmode > MAX_SLOWMODE_SECONDS) {
      return NextResponse.json(
        { error: `slowmode_delay must be an integer between 0 and ${MAX_SLOWMODE_SECONDS}` },
        { status: 400 }
      )
    }
    updates.slowmode_delay = slowmode
    changes.slowmode_delay = { old: channel.slowmode_delay, new: slowmode }
  }

  if ("stream_url" in body) {
    if (channel.type !== "stage") {
      return NextResponse.json({ error: "stream_url can only be edited for stage channels" }, { status: 400 })
    }
    const raw = body.stream_url
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json({ error: "stream_url must be a string or null" }, { status: 400 })
    }
    const sanitized = typeof raw === "string" ? raw.trim() : null
    if (sanitized && sanitized.length > 2048) {
      return NextResponse.json({ error: "stream_url must be 2048 characters or fewer" }, { status: 400 })
    }
    if (sanitized) {
      let parsed: URL
      try {
        parsed = new URL(sanitized)
      } catch {
        return NextResponse.json({ error: "stream_url must be a valid URL" }, { status: 400 })
      }
      const host = parsed.hostname.replace(/^www\./, "")
      const isYouTubeHost = host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be"
      if (!isYouTubeHost) {
        return NextResponse.json({ error: "Only YouTube URLs are currently supported" }, { status: 400 })
      }
    }
    updates.stream_url = sanitized
    changes.stream_url = { old: channel.stream_url, new: sanitized }
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })

  const { data: updated, error: dbErr } = await supabase
    .from("channels")
    .update(updates)
    .eq("id", channelId)
    .select()
    .single()

  if (dbErr) {
    console.error("[channels PATCH] DB error", {
      action: "channel_update",
      serverId,
      channelId,
      userId: user!.id,
      err: dbErr,
    })
    return NextResponse.json({ error: "Failed to update channel" }, { status: 500 })
  }

  // Audit log
  const { error: auditError } = await supabase.from("audit_logs").insert({
    server_id: serverId,
    actor_id: user!.id,
    action: "channel_update",
    target_id: channelId,
    target_type: "channel",
    changes: changes as unknown as Json,
  })

  if (auditError) {
    console.error(`Audit log failed for channel_update server=${serverId} channel=${channelId} actor=${user!.id}:`, auditError.message)
  }

  try {
    invalidate(`channel:${channelId}`)
    invalidatePrefix(`perms:${serverId}:${channelId}`)
  } catch (cacheErr) {
    console.error("[channels PATCH] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
  }

  return NextResponse.json(updated)
  } catch (err) {
    console.error("[channels PATCH] unhandled error", {
      action: "channel_update",
      serverId,
      channelId,
      userId,
      err,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
