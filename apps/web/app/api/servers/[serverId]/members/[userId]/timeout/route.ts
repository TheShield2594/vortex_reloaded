/**
 * PUT    /api/servers/[serverId]/members/[userId]/timeout
 *   Apply or update a timeout for a member.
 *   Body: { duration_seconds: number, reason?: string }
 *
 * DELETE /api/servers/[serverId]/members/[userId]/timeout
 *   Remove an active timeout.
 *
 * Requires MODERATE_MEMBERS permission or ownership.
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { aggregateMemberPermissions } from "@/lib/server-auth"
import { PERMISSIONS } from "@vortex/shared"
import { sendPushToUser } from "@/lib/push"

const MAX_TIMEOUT_SECONDS = 2_419_200  // 28 days

type Params = { params: Promise<{ serverId: string; userId: string }> }

async function checkModeratePermission(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  serverId: string,
  actorId: string,
  ownerId: string
): Promise<boolean> {
  if (actorId === ownerId) return true
  const { data: member } = await supabase
    .from("server_members")
    .select("member_roles(roles(permissions))")
    .eq("server_id", serverId)
    .eq("user_id", actorId)
    .single()

  const memberRolesRaw = member && typeof member === "object"
    ? (member as Record<string, unknown>).member_roles
    : undefined
  const perms = aggregateMemberPermissions(Array.isArray(memberRolesRaw) ? memberRolesRaw : [])
  return (perms & PERMISSIONS.MODERATE_MEMBERS) !== 0
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { serverId, userId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: server, error: serverError } = await supabase.from("servers").select("owner_id").eq("id", serverId).single()
    if (serverError || !server) return NextResponse.json({ error: "Server not found" }, { status: 404 })
    if (userId === server.owner_id) return NextResponse.json({ error: "Cannot timeout the server owner" }, { status: 400 })

    // Prevent moderators from timing out their own account
    if (userId === user.id) return NextResponse.json({ error: "Cannot timeout yourself" }, { status: 400 })

    const canModerate = await checkModeratePermission(supabase, serverId, user.id, server.owner_id)
    if (!canModerate) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await req.json()
    const { duration_seconds, reason } = body

    if (typeof duration_seconds !== "number" || !Number.isFinite(duration_seconds) || duration_seconds <= 0)
      return NextResponse.json({ error: "duration_seconds must be a positive number" }, { status: 400 })
    if (duration_seconds > MAX_TIMEOUT_SECONDS)
      return NextResponse.json(
        { error: `duration_seconds must not exceed ${MAX_TIMEOUT_SECONDS} (28 days)` },
        { status: 400 }
      )
    if (reason !== undefined && typeof reason !== "string")
      return NextResponse.json({ error: "reason must be a string" }, { status: 400 })

    const until = new Date(Date.now() + duration_seconds * 1000).toISOString()

    const { error } = await supabase.from("member_timeouts").upsert(
      {
        server_id: serverId,
        user_id: userId,
        timed_out_until: until,
        moderator_id: user.id,
        reason: reason ?? null,
        created_at: new Date().toISOString(),
      },
      { onConflict: "server_id,user_id" }
    )

    if (error) return NextResponse.json({ error: "Failed to apply timeout" }, { status: 500 })

    const { error: auditErr } = await supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: user.id,
      action: "member_timeout",
      target_id: userId,
      target_type: "user",
      changes: { duration_seconds, reason: reason ?? null, until },
    })
    if (auditErr) {
      console.error("[timeout] Audit log insert failed for member_timeout", { serverId, userId, error: auditErr.message })
    }

    // Notify the timed-out user
    const { data: serverInfo } = await supabase.from("servers").select("name").eq("id", serverId).maybeSingle()
    sendPushToUser(userId, {
      title: `Timed out in ${serverInfo?.name ?? "a server"}`,
      body: reason ? `Reason: ${reason}` : `You are timed out until ${new Date(until).toLocaleString()}`,
      url: `/channels/${serverId}`,
      tag: `timeout-${serverId}`,
    }).catch(() => {})

    return NextResponse.json({ message: "Member timed out", until })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { serverId, userId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: server, error: serverError } = await supabase.from("servers").select("owner_id").eq("id", serverId).single()
    if (serverError || !server) return NextResponse.json({ error: "Server not found" }, { status: 404 })

    const canModerate = await checkModeratePermission(supabase, serverId, user.id, server.owner_id)
    if (!canModerate) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { error } = await supabase
      .from("member_timeouts")
      .delete()
      .eq("server_id", serverId)
      .eq("user_id", userId)

    if (error) return NextResponse.json({ error: "Failed to remove timeout" }, { status: 500 })

    const { error: removeAuditErr } = await supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: user.id,
      action: "member_timeout_remove",
      target_id: userId,
      target_type: "user",
      changes: null,
    })
    if (removeAuditErr) {
      console.error("[timeout] Audit log insert failed for member_timeout_remove", { serverId, userId, error: removeAuditErr.message })
    }

    return NextResponse.json({ message: "Timeout removed" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
