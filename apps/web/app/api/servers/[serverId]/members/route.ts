import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission, PERMISSIONS } from "@/lib/permissions"
import { filterBlockedUserIds, getBlockedUserIdsForViewer } from "@/lib/social-block-policy"
import { requireAuth, parseJsonBody, insertAuditLog } from "@/lib/utils/api-helpers"

export async function GET(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string }> }
) {
  try {
  const params = await paramsPromise
  const { supabase, user, error: authError } = await requireAuth()
  if (authError) return authError

  // Verify the requester is a member of this server
  const { data: membership } = await supabase
    .from("server_members")
    .select("user_id")
    .eq("server_id", params.serverId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this server" }, { status: 403 })
  }

  // Use service role for the full member list payload because RLS policies can
  // legitimately scope user-token reads down to only the requester row.
  let adminSupabase
  try {
    adminSupabase = await createServiceRoleClient()
  } catch (error) {
    const errorId = crypto.randomUUID()
    const errorName = error instanceof Error ? error.name : "UnknownError"
    console.error(`[${errorId}] Failed to initialize service-role Supabase client for member list (${errorName})`)
    return NextResponse.json({ error: "Failed to initialize member list service" }, { status: 500 })
  }

  // Pagination: cursor-based using user_id for stable ordering.
  // When neither `limit` nor `after` is specified, return all members for
  // backward compatibility with existing callers (member-list, role-manager).
  const { searchParams } = new URL(request.url)
  const rawLimit = searchParams.get("limit")
  const afterCursor = searchParams.get("after")
  const isPaginated = rawLimit !== null || afterCursor !== null

  let limit: number
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      return NextResponse.json({ error: "Invalid limit (must be 1-500)" }, { status: 400 })
    }
    limit = parsed
  } else {
    limit = isPaginated ? 100 : 10_000 // no practical limit for full-list callers
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (afterCursor && !uuidRegex.test(afterCursor)) {
    return NextResponse.json({ error: "Invalid after cursor" }, { status: 400 })
  }

  // Slim projection for member lists — omits status_message, bio, banner_color,
  // custom_tag which are only needed for profile modals (~60-70% payload reduction).
  // Use ?fields=full to get the complete profile data.
  const fieldsParam = searchParams.get("fields")
  const wantFull = fieldsParam === "full"

  const MEMBER_SELECT_FULL = `
      server_id,
      user_id,
      nickname,
      user:users!server_members_user_id_fkey(
        id,
        username,
        display_name,
        avatar_url,
        status_message,
        bio,
        banner_color,
        custom_tag,
        game_activity,
        created_at,
        last_online_at
      ),
      roles:member_roles(
        role_id,
        roles(
          id,
          server_id,
          name,
          color,
          permissions,
          position,
          created_at
        )
      )
    ` as const

  const MEMBER_SELECT_SLIM = `
      server_id,
      user_id,
      nickname,
      user:users!server_members_user_id_fkey(
        id,
        username,
        display_name,
        avatar_url,
        status_message,
        bio,
        banner_color,
        custom_tag,
        game_activity,
        created_at,
        last_online_at
      ),
      roles:member_roles(
        role_id,
        roles(
          id,
          server_id,
          name,
          color,
          permissions,
          position,
          created_at
        )
      )
    ` as const

  // Fallback select without game_activity or last_online_at for environments
  // where recent migrations haven't been applied yet.
  const MEMBER_SELECT_COMPAT = `
      server_id,
      user_id,
      nickname,
      user:users!server_members_user_id_fkey(
        id,
        username,
        display_name,
        avatar_url,
        status_message,
        bio,
        banner_color,
        custom_tag,
        created_at
      ),
      roles:member_roles(
        role_id,
        roles(
          id,
          server_id,
          name,
          color,
          permissions,
          position,
          created_at
        )
      )
    ` as const

  let query = adminSupabase
    .from("server_members")
    .select(wantFull ? MEMBER_SELECT_FULL : MEMBER_SELECT_SLIM)
    .eq("server_id", params.serverId)
    .order("user_id", { ascending: true })
    .limit(limit + 1) // fetch one extra to detect next page

  if (afterCursor) {
    query = query.gt("user_id", afterCursor)
  }

  let { data: members, error } = await query

  // If the query fails (e.g. last_online_at column missing), retry without it
  if (error) {
    console.warn("[members] GET query failed, retrying without last_online_at", { code: error.code, message: error.message })
    let fallbackQuery = adminSupabase
      .from("server_members")
      .select(MEMBER_SELECT_COMPAT)
      .eq("server_id", params.serverId)
      .order("user_id", { ascending: true })
      .limit(limit + 1)
    if (afterCursor) fallbackQuery = fallbackQuery.gt("user_id", afterCursor)
    const fallback = await fallbackQuery
    // Normalize: add fields omitted by COMPAT select to match primary query shape
    if (fallback.data) {
      members = fallback.data.map((m) => {
        if (!m.user) return m
        const normalizedUser = { ...m.user, game_activity: null, last_online_at: null }
        return { ...m, user: normalizedUser }
      }) as typeof members
    } else {
      members = null
    }
    error = fallback.error
  }

  if (error) {
    console.error("[members] GET query failed", { serverId: params.serverId, code: error.code, message: error.message, details: error.details })
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 })
  }

  const allMembers = members ?? []
  const hasMore = allMembers.length > limit
  const pageMembers = hasMore ? allMembers.slice(0, limit) : allMembers

  let blockedUserIds: Set<string>
  try {
    blockedUserIds = await getBlockedUserIdsForViewer(supabase, user.id)
  } catch (blockErr) {
    console.error("[members] Failed to resolve block policy", {
      serverId: params.serverId,
      userId: user.id,
      error: blockErr instanceof Error ? blockErr.message : String(blockErr),
    })
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 })
  }
  const visibleMembers = filterBlockedUserIds(pageMembers, (member) => member.user_id, blockedUserIds)

  const lastMember = pageMembers[pageMembers.length - 1]
  const nextCursor = hasMore && lastMember ? lastMember.user_id : null

  // Return array directly for backward compatibility; cursor in header.
  return NextResponse.json(visibleMembers, {
    headers: {
      "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
      ...(nextCursor ? { "X-Next-Cursor": nextCursor } : {}),
    },
  })
  } catch (err) {
    console.error("[servers/[serverId]/members GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string }> }
) {
  try {
    const params = await paramsPromise
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get("userId")
    if (!targetUserId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    // Allow self-removal (leaving) or require KICK_MEMBERS permission
    if (targetUserId !== user.id) {
      const { isOwner, isAdmin, permissions, ownerId } = await getMemberPermissions(supabase, params.serverId, user.id)

      if (!isAdmin && !hasPermission(permissions, "KICK_MEMBERS")) {
        return NextResponse.json({ error: "Missing KICK_MEMBERS permission" }, { status: 403 })
      }

      // Prevent kicking the server owner
      if (targetUserId === ownerId) {
        return NextResponse.json({ error: "Cannot remove the server owner" }, { status: 400 })
      }

      // Non-owners cannot kick admins
      if (!isOwner) {
        const { permissions: targetPerms } = await getMemberPermissions(supabase, params.serverId, targetUserId)
        if (targetPerms & PERMISSIONS.ADMINISTRATOR) {
          return NextResponse.json({ error: "Cannot kick a member with Administrator" }, { status: 403 })
        }
      }
    }

    const { error } = await supabase
      .from("server_members")
      .delete()
      .eq("server_id", params.serverId)
      .eq("user_id", targetUserId)

    if (error) return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })

    // Audit log for successful kick/leave
    await insertAuditLog(supabase, {
      server_id: params.serverId,
      actor_id: user.id,
      action: targetUserId === user.id ? "member_leave" : "member_kick",
      target_id: targetUserId,
      target_type: "user",
      changes: null,
    })

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error("[servers/[serverId]/members DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/servers/[serverId]/members?userId=...
 * Body: { timeoutUntil: ISO-string | null }
 *
 * Applies or removes a timeout (MODERATE_MEMBERS permission required).
 * Passing null clears the timeout early.
 */
export async function PATCH(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string }> }
) {
  try {
    const params = await paramsPromise
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get("userId")
    if (!targetUserId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    const { data: body, error: parseError } = await parseJsonBody<{ timeoutUntil?: string | null }>(request as unknown as import("next/server").NextRequest)
    if (parseError) return parseError

    const { timeoutUntil } = body

    // Validate duration: max 28 days, must be in the future (or null to clear)
    if (timeoutUntil !== null && timeoutUntil !== undefined) {
      const until = new Date(timeoutUntil)
      if (isNaN(until.getTime())) {
        return NextResponse.json({ error: "Invalid timeoutUntil value" }, { status: 400 })
      }
      const maxMs = 28 * 24 * 60 * 60 * 1000
      if (until.getTime() - Date.now() > maxMs) {
        return NextResponse.json({ error: "Timeout duration exceeds 28-day maximum" }, { status: 400 })
      }
      if (until.getTime() <= Date.now()) {
        return NextResponse.json({ error: "timeoutUntil must be in the future" }, { status: 400 })
      }
    }

    // Check MODERATE_MEMBERS permission; also get ownerId to avoid an extra servers query
    const { isOwner, isAdmin, permissions, ownerId } = await getMemberPermissions(supabase, params.serverId, user.id)
    if (!isAdmin && !hasPermission(permissions, "MODERATE_MEMBERS")) {
      return NextResponse.json({ error: "Missing MODERATE_MEMBERS permission" }, { status: 403 })
    }

    // Prevent timing out the server owner
    if (targetUserId === ownerId) {
      return NextResponse.json({ error: "Cannot time out the server owner" }, { status: 400 })
    }

    // Non-owners cannot time out admins
    if (!isOwner) {
      const { permissions: targetPerms } = await getMemberPermissions(supabase, params.serverId, targetUserId)
      if (targetPerms & PERMISSIONS.ADMINISTRATOR) {
        return NextResponse.json({ error: "Cannot time out a member with Administrator" }, { status: 403 })
      }
    }

    // Persist to member_timeouts (the table messages/route.ts checks) via the
    // set_member_timeout SECURITY DEFINER function so no broad UPDATE policy is
    // required on server_members.
    const { error } = await supabase.rpc("set_member_timeout", {
      p_server_id: params.serverId,
      p_member_id: targetUserId,
      p_timeout_until: timeoutUntil ?? null,
      p_moderator_id: user.id,
      p_reason: null,
    })

    if (error) return NextResponse.json({ error: "Failed to update member timeout" }, { status: 500 })

    // Audit log
    await insertAuditLog(supabase, {
      server_id: params.serverId,
      actor_id: user.id,
      action: timeoutUntil ? "member_timeout" : "member_timeout_remove",
      target_id: targetUserId,
      target_type: "user",
      changes: { timeout_until: timeoutUntil ?? null },
    })

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error("[servers/[serverId]/members PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
