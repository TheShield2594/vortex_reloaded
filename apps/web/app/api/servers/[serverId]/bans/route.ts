import { NextRequest, NextResponse } from "next/server"
import { requireAuth, insertAuditLog } from "@/lib/utils/api-helpers"
import { hasPermission as checkPermission } from "@vortex/shared"
import { aggregateMemberPermissions } from "@/lib/server-auth"
import { getActorMaxRolePosition } from "@/lib/role-utils"
import { rateLimiter } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { sendPushToUser } from "@/lib/push"

const log = createLogger("api/bans")

// GET /api/servers/[serverId]/bans — list bans
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Must be owner or have BAN permission
    const { data: member } = await supabase
      .from("server_members")
      .select("server_id, member_roles(roles(permissions))")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .single()

    const { data: server } = await supabase
      .from("servers")
      .select("owner_id")
      .eq("id", serverId)
      .single()

    const isOwner = server?.owner_id === user.id
    const memberRolesRaw = member && typeof member === "object"
      ? (member as Record<string, unknown>).member_roles
      : undefined
    const permissions = aggregateMemberPermissions(Array.isArray(memberRolesRaw) ? memberRolesRaw : [])

    if (!isOwner && !checkPermission(permissions, "BAN_MEMBERS")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: bans, error } = await supabase
      .from("server_bans")
      .select("*, user:users!server_bans_user_id_fkey(id, username, display_name, avatar_url), banned_by_user:users!server_bans_banned_by_fkey(id, username, display_name)")
      .eq("server_id", serverId)
      .order("banned_at", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to fetch bans" }, { status: 500 })
    return NextResponse.json(bans)

  } catch (err) {
    console.error("[servers/[serverId]/bans GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/servers/[serverId]/bans — ban a user
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
  const { serverId } = await params
  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError

  // Rate limit: 10 ban actions per 5 minutes per moderator
  const rl = await rateLimiter.check(`ban:${user.id}`, { limit: 10, windowMs: 5 * 60_000 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many ban actions. Please slow down." }, { status: 429 })
  }

  const { userId, reason } = await req.json()
  if (typeof userId !== "string" || !userId.trim()) return NextResponse.json({ error: "userId required" }, { status: 400 })

  const { data: server } = await supabase
    .from("servers")
    .select("owner_id")
    .eq("id", serverId)
    .single()

  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 })
  if (userId === server.owner_id) return NextResponse.json({ error: "Cannot ban the server owner" }, { status: 400 })

  const isOwner = server.owner_id === user.id
  if (!isOwner) {
    const { data: member } = await supabase
      .from("server_members")
      .select("member_roles(roles(permissions))")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .single()

    const memberRolesRaw = member && typeof member === "object"
      ? (member as Record<string, unknown>).member_roles
      : undefined
    const permissions = aggregateMemberPermissions(Array.isArray(memberRolesRaw) ? memberRolesRaw : [])

    if (!checkPermission(permissions, "BAN_MEMBERS")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Role hierarchy check: requester must outrank the target.
    let requesterMaxPosition: number
    let targetMaxPosition: number
    try {
      [requesterMaxPosition, targetMaxPosition] = await Promise.all([
        getActorMaxRolePosition(supabase, serverId, user.id),
        getActorMaxRolePosition(supabase, serverId, userId),
      ])
    } catch (err) {
      log.error({
        serverId,
        actorId: user.id,
        targetId: userId,
        err,
      }, "Failed to evaluate ban hierarchy")
      const { error: auditError } = await insertAuditLog(supabase, {
        server_id: serverId,
        actor_id: user.id,
        action: "member_ban_denied",
        target_id: userId,
        target_type: "user",
        changes: { reason: "hierarchy_lookup_failed" },
      })
      if (auditError) {
        log.error({ serverId, actorId: user.id, targetId: userId, err: auditError.message }, "Failed to write denied-ban audit log")
      }
      return NextResponse.json({ error: "Unable to verify role hierarchy" }, { status: 500 })
    }

    if (targetMaxPosition >= requesterMaxPosition) {
      const { error: auditError } = await insertAuditLog(supabase, {
        server_id: serverId,
        actor_id: user.id,
        action: "member_ban_denied",
        target_id: userId,
        target_type: "user",
        changes: { reason: "target_outranks_actor" },
      })
      if (auditError) {
        log.error({ serverId, actorId: user.id, targetId: userId, err: auditError.message }, "Failed to write denied-ban audit log")
      }
      return NextResponse.json(
        { error: "Cannot ban a member with equal or higher role" },
        { status: 403 }
      )
    }
  }

  const { data: existingBan, error: existingBanError } = await supabase
    .from("server_bans")
    .select("server_id, user_id, banned_by, reason, banned_at")
    .eq("server_id", serverId)
    .eq("user_id", userId)
    .maybeSingle()

  if (existingBanError) return NextResponse.json({ error: "Failed to check existing ban" }, { status: 500 })

  const { error } = await supabase
    .from("server_bans")
    .upsert({
      server_id: serverId,
      user_id: userId,
      banned_by: user.id,
      reason: reason ?? null,
    })

  if (error) return NextResponse.json({ error: "Failed to ban user" }, { status: 500 })

  const { error: memberDeleteError } = await supabase
    .from("server_members")
    .delete()
    .eq("server_id", serverId)
    .eq("user_id", userId)

  if (memberDeleteError) {
    let rollbackError: { message?: string } | null = null

    if (existingBan) {
      const rollbackResult = await supabase
        .from("server_bans")
        .upsert(existingBan)
      rollbackError = rollbackResult.error
    } else {
      const rollbackResult = await supabase
        .from("server_bans")
        .delete()
        .eq("server_id", serverId)
        .eq("user_id", userId)
      rollbackError = rollbackResult.error
    }

    log.warn({
      serverId,
      userId,
      err: memberDeleteError.message,
      rollbackError: rollbackError?.message,
    }, "Failed to remove member after ban")
    return NextResponse.json({ error: "Failed to ban user" }, { status: 500 })
  }

  const { error: voiceDeleteError } = await supabase
    .from("voice_states")
    .delete()
    .eq("server_id", serverId)
    .eq("user_id", userId)

  if (voiceDeleteError) {
    log.warn({ serverId, userId, err: voiceDeleteError.message }, "Failed to remove voice state after ban")
  }

  // Audit log
  const { error: banAuditError } = await insertAuditLog(supabase, {
    server_id: serverId,
    actor_id: user.id,
    action: "member_ban",
    target_id: userId,
    target_type: "user",
    changes: { reason },
  })
  if (banAuditError) {
    log.warn({ serverId, actorId: user.id, targetId: userId, err: banAuditError.message }, "Failed to write ban audit log")
  }

  // Notify the banned user
  const { data: serverInfo } = await supabase.from("servers").select("name").eq("id", serverId).maybeSingle()
  sendPushToUser(userId, {
    title: `Banned from ${serverInfo?.name ?? "a server"}`,
    body: reason ? `Reason: ${reason}` : "You have been banned from this server",
    url: "/channels/me",
    tag: `ban-${serverId}`,
  }).catch((err) => { log.error({ err }, "Failed to send ban push notification") })

  return NextResponse.json({ message: "User banned" })
  } catch (err) {
    log.error({ err }, "Unexpected error in ban handler")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/servers/[serverId]/bans?userId= — unban
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
  const { serverId } = await params
  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get("userId")?.trim()
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

  const { data: server } = await supabase
    .from("servers")
    .select("owner_id")
    .eq("id", serverId)
    .single()

  const isOwner = server?.owner_id === user.id
  if (!isOwner) {
    const { data: member } = await supabase
      .from("server_members")
      .select("member_roles(roles(permissions))")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .single()

    const memberRolesRaw = member && typeof member === "object"
      ? (member as Record<string, unknown>).member_roles
      : undefined
    const permissions = aggregateMemberPermissions(Array.isArray(memberRolesRaw) ? memberRolesRaw : [])

    if (!checkPermission(permissions, "BAN_MEMBERS")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const { error } = await supabase
    .from("server_bans")
    .delete()
    .eq("server_id", serverId)
    .eq("user_id", userId)

  if (error) return NextResponse.json({ error: "Failed to unban user" }, { status: 500 })

  const { error: auditError } = await insertAuditLog(supabase, {
    server_id: serverId,
    actor_id: user.id,
    action: "member_unban",
    target_id: userId,
    target_type: "user",
    changes: {},
  })

  if (auditError) {
    log.warn({ serverId, userId, err: auditError.message }, "Failed to write unban audit log")
    // Unban already succeeded — don't fail the request over a non-critical audit log write
  }

  return NextResponse.json({ message: "User unbanned" })
  } catch (err) {
    log.error({ err }, "Unexpected error in unban handler")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
