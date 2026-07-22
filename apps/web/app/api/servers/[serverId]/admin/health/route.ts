/**
 * GET /api/servers/[serverId]/admin/health
 *
 * Returns community health metrics for the server dashboard:
 * - Active member counts and trends
 * - Message activity
 * - Moderation action frequency
 * - Top channels by activity
 * - Unresolved appeals
 * - Permission conflict warnings
 *
 * Requires ADMINISTRATOR permission.
 */
import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions } from "@/lib/permissions"
import { PERMISSIONS } from "@vortex/shared"

interface ChannelRow { id: string; name: string }

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serverId: string }> }
): Promise<NextResponse> {
  const { serverId } = await params

  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { isAdmin } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()

    // Fetch all channel IDs for this server (messages are per-channel, not per-server)
    const { data: serverChannels } = await supabase
      .from("channels")
      .select("id, name")
      .eq("server_id", serverId)
    const channelIds = (serverChannels ?? []).map((c: ChannelRow) => c.id)

    // Active members (distinct authors in last 7 days vs previous 7 days)
    let currentActive = 0
    let previousActive = 0
    if (channelIds.length > 0) {
      // Fetch distinct author_ids for current period
      const { data: currentAuthors } = await supabase
        .from("messages")
        .select("author_id")
        .in("channel_id", channelIds)
        .gte("created_at", sevenDaysAgo)
      currentActive = new Set((currentAuthors ?? []).map((m: { author_id: string }) => m.author_id)).size

      // Fetch distinct author_ids for previous period
      const { data: previousAuthors } = await supabase
        .from("messages")
        .select("author_id")
        .in("channel_id", channelIds)
        .gte("created_at", fourteenDaysAgo)
        .lt("created_at", sevenDaysAgo)
      previousActive = new Set((previousAuthors ?? []).map((m: { author_id: string }) => m.author_id)).size
    }
    const activeTrend = previousActive === 0 ? 0 : Math.round(((currentActive - previousActive) / previousActive) * 100)

    // Messages today
    let messagesTodayCount = 0
    let messagesWeekCount = 0
    if (channelIds.length > 0) {
      const { count: mToday } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("channel_id", channelIds)
        .gte("created_at", todayStart)
      const { count: mWeek } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("channel_id", channelIds)
        .gte("created_at", sevenDaysAgo)
      messagesTodayCount = mToday ?? 0
      messagesWeekCount = mWeek ?? 0
    }

    // Moderation actions (last 7 days vs previous 7)
    const { count: modNow } = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("server_id", serverId)
      .gte("created_at", sevenDaysAgo)
    const { count: modPrev } = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("server_id", serverId)
      .gte("created_at", fourteenDaysAgo)
      .lt("created_at", sevenDaysAgo)

    const modActions = modNow ?? 0
    const modPrevActions = modPrev ?? 0
    const modTrend = modPrevActions === 0 ? 0 : Math.round(((modActions - modPrevActions) / modPrevActions) * 100)

    // Top channels by message count (this week) — query per channel, take top 5
    const topChannels: Array<{ id: string; name: string; message_count: number }> = []
    if (channelIds.length > 0) {
      const channelNameMap = new Map<string, string>()
      for (const ch of serverChannels ?? []) {
        channelNameMap.set((ch as ChannelRow).id, (ch as ChannelRow).name)
      }
      // Count messages per channel this week
      for (const chId of channelIds) {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("channel_id", chId)
          .gte("created_at", sevenDaysAgo)
        if ((count ?? 0) > 0) {
          topChannels.push({ id: chId, name: channelNameMap.get(chId) ?? chId, message_count: count ?? 0 })
        }
      }
      topChannels.sort((a, b) => b.message_count - a.message_count)
      topChannels.splice(5)
    }

    // Unresolved appeals
    const { count: unresolvedAppeals } = await supabase
      .from("moderation_appeals")
      .select("id", { count: "exact", head: true })
      .eq("server_id", serverId)
      .in("status", ["submitted", "reviewing"])

    // Permission warnings — detect conflicting overwrites
    const warnings: string[] = []
    const { data: roles } = await supabase
      .from("roles")
      .select("id, name, permissions")
      .eq("server_id", serverId)

    if (roles) {
      const adminRoles = roles.filter((r: { id: string; name: string; permissions: number }) => ((r.permissions ?? 0) & PERMISSIONS.ADMINISTRATOR) !== 0)
      if (adminRoles.length > 2) {
        warnings.push(`${adminRoles.length} roles have Administrator permission — consider reducing to minimize risk`)
      }

      // Check for channel permission overrides that deny VIEW_CHANNELS on @everyone
      const { data: permOverrides } = await supabase
        .from("channel_permissions")
        .select("channel_id, role_id, deny_permissions")

      if (permOverrides) {
        const defaultRole = roles.find((r: { id: string; name: string; permissions: number | null }) => r.name === "@everyone" || r.name === "everyone")
        if (defaultRole) {
          const deniedChannels = permOverrides.filter(
            (ow: { channel_id: string; role_id: string; deny_permissions: number }) =>
              ow.role_id === defaultRole.id && ((ow.deny_permissions ?? 0) & PERMISSIONS.VIEW_CHANNELS) !== 0
          )
          if (deniedChannels.length > 0) {
            warnings.push(`${deniedChannels.length} channel(s) hide from @everyone — verify this is intentional`)
          }
        }
      }
    }

    return NextResponse.json({
      active_members: {
        current: currentActive,
        previous: previousActive,
        trend: activeTrend,
      },
      messages_today: messagesTodayCount,
      messages_this_week: messagesWeekCount,
      moderation_actions_7d: modActions,
      moderation_actions_trend: modTrend,
      top_channels: topChannels,
      unresolved_appeals: unresolvedAppeals ?? 0,
      permission_warnings: warnings,
    })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
