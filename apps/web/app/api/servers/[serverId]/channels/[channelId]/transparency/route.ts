/**
 * GET /api/servers/[serverId]/channels/[channelId]/transparency
 *
 * Returns the transparency data for a channel: which roles can see it,
 * which are hidden, and recent moderation actions within it.
 *
 * Requires VIEW_CHANNELS permission.
 */
import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions } from "@/lib/permissions"
import { PERMISSIONS } from "@vortex/shared"

interface AuditEntry {
  id: string
  action: string
  actor_id: string | null
  created_at: string
  changes: Record<string, unknown> | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serverId: string; channelId: string }> }
): Promise<NextResponse> {
  const { serverId, channelId } = await params

  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { permissions } = await getMemberPermissions(supabase, serverId, user.id)
    if (!(permissions & PERMISSIONS.VIEW_CHANNELS) && !(permissions & PERMISSIONS.ADMINISTRATOR)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch channel info
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, name, server_id")
      .eq("id", channelId)
      .eq("server_id", serverId)
      .single()
    if (channelError || !channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 })
    }

    // Fetch all roles
    const { data: roles, error: rolesError } = await supabase
      .from("roles")
      .select("id, name, color, permissions, is_default")
      .eq("server_id", serverId)
      .order("position", { ascending: true })
    if (rolesError || !roles) {
      return NextResponse.json({ error: "Failed to load roles" }, { status: 500 })
    }

    // Fetch channel permission overrides (correct table: channel_permissions)
    const { data: permOverrides, error: permError } = await supabase
      .from("channel_permissions")
      .select("role_id, allow_permissions, deny_permissions")
      .eq("channel_id", channelId)
    if (permError) {
      return NextResponse.json({ error: "Failed to load channel permissions" }, { status: 500 })
    }

    // Compute role visibility
    const overwriteMap = new Map<string, { allow: number; deny: number }>()
    if (permOverrides) {
      for (const ow of permOverrides) {
        overwriteMap.set(ow.role_id, { allow: ow.allow_permissions, deny: ow.deny_permissions })
      }
    }

    const visibleTo: Array<{ id: string; name: string; color: string; can_view: boolean }> = []
    const hiddenFrom: Array<{ id: string; name: string; color: string; can_view: boolean }> = []

    for (const role of roles) {
      const ow = overwriteMap.get(role.id)
      const perms = role.permissions ?? 0
      const hasAdmin = (perms & PERMISSIONS.ADMINISTRATOR) !== 0
      const baseCanView = (perms & PERMISSIONS.VIEW_CHANNELS) !== 0

      let canView = hasAdmin || baseCanView
      if (ow) {
        if (ow.deny & PERMISSIONS.VIEW_CHANNELS) canView = false
        if (ow.allow & PERMISSIONS.VIEW_CHANNELS) canView = true
        if (hasAdmin) canView = true
      }

      const entry = { id: role.id, name: role.name, color: role.color ?? "", can_view: canView }
      if (canView) {
        visibleTo.push(entry)
      } else {
        hiddenFrom.push(entry)
      }
    }

    // Fetch recent moderation actions (last 7 days) — audit_logs table, filter by changes
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: auditEntries } = await supabase
      .from("audit_logs")
      .select("id, action, actor_id, created_at, changes")
      .eq("server_id", serverId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(200)

    // Filter to entries relevant to this channel (where changes JSON contains channelId)
    const channelActions = ((auditEntries ?? []) as AuditEntry[]).filter((entry: AuditEntry) => {
      const meta = entry.changes as Record<string, unknown> | null
      return meta?.channel_id === channelId || meta?.channelId === channelId
    }).slice(0, 10)

    // Resolve actor names
    const actorIds = [...new Set(channelActions.map((a: AuditEntry) => a.actor_id).filter(Boolean))] as string[]
    const actorMap = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: actors } = await supabase
        .from("users")
        .select("id, username, display_name")
        .in("id", actorIds)
      if (actors) {
        for (const a of actors) {
          actorMap.set(a.id, a.display_name ?? a.username)
        }
      }
    }

    const recentActions = channelActions.map((entry: AuditEntry) => ({
      id: entry.id,
      action: entry.action,
      actor_name: entry.actor_id ? (actorMap.get(entry.actor_id) ?? "Unknown") : "System",
      created_at: entry.created_at,
      reason: null,
    }))

    return NextResponse.json({
      channel_name: channel.name,
      visible_to: visibleTo,
      hidden_from: hiddenFrom,
      recent_actions: recentActions,
    })
  } catch (err: unknown) {
    console.error("[transparency] Failed to load transparency data", { serverId, channelId, error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
