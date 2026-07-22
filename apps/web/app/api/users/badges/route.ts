/**
 * GET  /api/users/badges?userId=<id>  — fetch badges for a specific user
 * POST /api/users/badges              — award a badge (admin only)
 * DELETE /api/users/badges?userId=<id>&badgeId=<id> — revoke a badge (admin only)
 */
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth, requireAuthWithServiceRole, insertAuditLog } from "@/lib/utils/api-helpers"
import { hasPermission } from "@vortex/shared"
import { aggregateMemberPermissions } from "@/lib/server-auth"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()

    const { data: badges, error } = await supabase
      .from("user_badges")
      .select("*, badge:badge_definitions(*)")
      .eq("user_id", userId)
      .order("awarded_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: "Failed to fetch user badges" }, { status: 500 })
    }

    return NextResponse.json(badges)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, serviceSupabase, user, error: authError } = await requireAuthWithServiceRole()
    if (authError || !serviceSupabase || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { userId, badgeId, serverId } = body as { userId?: string; badgeId?: string; serverId?: string }
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (!badgeId || typeof badgeId !== "string") {
      return NextResponse.json({ error: "badgeId is required" }, { status: 400 })
    }

    // Permission check: must be a server admin if serverId is provided,
    // otherwise must be a platform-level operation (only service role)
    if (serverId) {
      const { data: memberRoles } = await supabase
        .from("member_roles")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .eq("server_id", serverId)

      const { data: server } = await supabase
        .from("servers")
        .select("owner_id")
        .eq("id", serverId)
        .single()

      const isOwner = server?.owner_id === user.id
      const perms = aggregateMemberPermissions(memberRoles)

      if (!isOwner && !hasPermission(perms, "ADMINISTRATOR")) {
        return NextResponse.json({ error: "Forbidden — requires ADMINISTRATOR permission" }, { status: 403 })
      }
    }

    // Validate badge exists
    const { data: badgeDef } = await serviceSupabase
      .from("badge_definitions")
      .select("id")
      .eq("id", badgeId)
      .single()

    if (!badgeDef) {
      return NextResponse.json({ error: "Badge not found" }, { status: 404 })
    }

    // Award the badge
    const { data: awarded, error: insertError } = await serviceSupabase
      .from("user_badges")
      .insert({
        user_id: userId,
        badge_id: badgeId,
        awarded_by: user.id,
        metadata: serverId ? { server_id: serverId } : null,
      })
      .select("*, badge:badge_definitions(*)")
      .single()

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "User already has this badge" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to award badge" }, { status: 500 })
    }

    // Audit log if in a server context
    if (serverId) {
      await insertAuditLog(supabase, {
        server_id: serverId,
        actor_id: user.id,
        action: "badge_award",
        target_id: userId,
        target_type: "user",
        changes: { badge_id: badgeId },
      })
    }

    return NextResponse.json(awarded, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, serviceSupabase, user, error: authError } = await requireAuthWithServiceRole()
    if (authError || !serviceSupabase || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("userId")
    const badgeId = searchParams.get("badgeId")
    const serverId = searchParams.get("serverId")

    if (!userId || !badgeId) {
      return NextResponse.json({ error: "userId and badgeId are required" }, { status: 400 })
    }

    // Permission check: must be a server admin if serverId is provided
    if (serverId) {
      const { data: memberRoles } = await supabase
        .from("member_roles")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .eq("server_id", serverId)

      const { data: server } = await supabase
        .from("servers")
        .select("owner_id")
        .eq("id", serverId)
        .single()

      const isOwner = server?.owner_id === user.id
      const perms = aggregateMemberPermissions(memberRoles)

      if (!isOwner && !hasPermission(perms, "ADMINISTRATOR")) {
        return NextResponse.json({ error: "Forbidden — requires ADMINISTRATOR permission" }, { status: 403 })
      }
    }

    const { error: deleteError } = await serviceSupabase
      .from("user_badges")
      .delete()
      .eq("user_id", userId)
      .eq("badge_id", badgeId)

    if (deleteError) {
      return NextResponse.json({ error: "Failed to revoke badge" }, { status: 500 })
    }

    if (serverId) {
      await insertAuditLog(supabase, {
        server_id: serverId,
        actor_id: user.id,
        action: "badge_revoke",
        target_id: userId,
        target_type: "user",
        changes: { badge_id: badgeId },
      })
    }

    return NextResponse.json({ message: "Badge revoked" })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
