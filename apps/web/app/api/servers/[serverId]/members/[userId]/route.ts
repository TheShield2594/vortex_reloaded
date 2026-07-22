/**
 * DELETE /api/servers/[serverId]/members/[userId]
 *   Kick a member from the server.  Requires KICK_MEMBERS permission or ownership.
 *
 * GET /api/servers/[serverId]/members/[userId]
 *   Fetch a single member's profile including timeout status.
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { aggregateMemberPermissions } from "@/lib/server-auth"
import { requireAuth, insertAuditLog } from "@/lib/utils/api-helpers"
import { rateLimiter } from "@/lib/rate-limit"

import { PERMISSIONS } from "@vortex/shared"
import { sendPushToUser } from "@/lib/push"

type Params = { params: Promise<{ serverId: string; userId: string }> }

async function getMemberPermissions(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, serverId: string, userId: string) {
  const { data: member } = await supabase
    .from("server_members")
    .select("member_roles(roles(permissions))")
    .eq("server_id", serverId)
    .eq("user_id", userId)
    .single()

  const memberRolesRaw = member && typeof member === "object"
    ? (member as Record<string, unknown>).member_roles
    : undefined
  return aggregateMemberPermissions(Array.isArray(memberRolesRaw) ? memberRolesRaw : [])
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId, userId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Must be a member to fetch others' profiles
    const { data: ownMembership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!ownMembership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const { data: member, error } = await supabase
      .from("server_members")
      .select("*, user:users(*), roles:member_roles(role_id, roles(*))")
      .eq("server_id", serverId)
      .eq("user_id", userId)
      .single()

    if (error || !member) return NextResponse.json({ error: "Member not found" }, { status: 404 })

    // Include timeout status
    const { data: timeout } = await supabase
      .from("member_timeouts")
      .select("timed_out_until, reason, moderator_id")
      .eq("server_id", serverId)
      .eq("user_id", userId)
      .maybeSingle()

    const timedOut =
      timeout && new Date(timeout.timed_out_until) > new Date()
        ? { until: timeout.timed_out_until, reason: timeout.reason }
        : null

    return NextResponse.json({ ...member, timeout: timedOut })

  } catch (err) {
    console.error("[servers/[serverId]/members/[userId] GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { serverId, userId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Rate limit: 10 kick actions per 5 minutes per moderator
    const rl = await rateLimiter.check(`kick:${user.id}`, { limit: 10, windowMs: 5 * 60_000 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many kick actions. Please slow down." }, { status: 429 })
    }

    const { searchParams } = new URL(req.url)
    const reason = searchParams.get("reason") ?? undefined

    const { data: server } = await supabase.from("servers").select("owner_id").eq("id", serverId).single()
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 })
    if (userId === server.owner_id) return NextResponse.json({ error: "Cannot kick the server owner" }, { status: 400 })

    const isOwner = server.owner_id === user.id
    if (!isOwner) {
      const perms = await getMemberPermissions(supabase, serverId, user.id)
      if ((perms & PERMISSIONS.KICK_MEMBERS) === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

      // Role hierarchy check: requester must outrank the target.
      // Fetch both members' role positions and compare.
      const [requesterRoles, targetRoles] = await Promise.all([
        supabase
          .from("member_roles")
          .select("roles(position)")
          .eq("server_id", serverId)
          .eq("user_id", user.id),
        supabase
          .from("member_roles")
          .select("roles(position)")
          .eq("server_id", serverId)
          .eq("user_id", userId),
      ])

      interface RoleJoin { roles: { position: number } | null }
      const requesterMaxPosition = (requesterRoles.data as RoleJoin[] ?? []).reduce(
        (max: number, mr: RoleJoin) => Math.max(max, mr.roles?.position ?? 0),
        0
      )
      const targetMaxPosition = (targetRoles.data as RoleJoin[] ?? []).reduce(
        (max: number, mr: RoleJoin) => Math.max(max, mr.roles?.position ?? 0),
        0
      )

      if (targetMaxPosition >= requesterMaxPosition) {
        return NextResponse.json(
          { error: "Cannot kick a member with equal or higher role" },
          { status: 403 }
        )
      }
    }

    const { error } = await supabase
      .from("server_members")
      .delete()
      .eq("server_id", serverId)
      .eq("user_id", userId)

    if (error) return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })

    // Force realtime/voice access revocation for active sessions in this server.
    // This removes active voice presence rows immediately.
    await supabase
      .from("voice_states")
      .delete()
      .eq("server_id", serverId)
      .eq("user_id", userId)

    await insertAuditLog(supabase, {
      server_id: serverId,
      actor_id: user.id,
      action: "member_kick",
      target_id: userId,
      target_type: "user",
      changes: { reason: reason ?? null },
    })

    // Notify the kicked user
    const { data: serverInfo } = await supabase.from("servers").select("name").eq("id", serverId).maybeSingle()
    sendPushToUser(userId, {
      title: `Removed from ${serverInfo?.name ?? "a server"}`,
      body: reason ? `Reason: ${reason}` : "You have been removed from this server",
      url: "/channels/me",
      tag: `kick-${serverId}`,
    }).catch(() => {})

    return NextResponse.json({ message: "Member kicked" })

  } catch (err) {
    console.error("[servers/[serverId]/members/[userId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
