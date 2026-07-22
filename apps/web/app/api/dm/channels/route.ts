import { NextRequest, NextResponse } from "next/server"
import { requireAuth, parseJsonBody, checkRateLimit } from "@/lib/utils/api-helpers"

// GET /api/dm/channels — list all DM channels with unread counts
export async function GET() {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // 1. Get all channel IDs the user belongs to
    const { data: memberships, error } = await supabase
      .from("dm_channel_members")
      .select("dm_channel_id")
      .eq("user_id", user.id)

    if (error) return NextResponse.json({ error: "Failed to fetch DM channels" }, { status: 500 })

    const channelIds = memberships?.map((m) => m.dm_channel_id) ?? []
    if (!channelIds.length) return NextResponse.json([])

    // 2-6. Fetch channel metadata, members, latest messages, and read states in parallel
    const [channelResult, memberResult, latestResult, readsResult] = await Promise.all([
      supabase
        .from("dm_channels")
        .select("id, name, icon_url, is_group, owner_id, updated_at, is_encrypted, encryption_key_version, encryption_membership_epoch")
        .in("id", channelIds),
      supabase
        .from("dm_channel_members")
        .select("dm_channel_id, user_id")
        .in("dm_channel_id", channelIds),
      supabase
        .from("direct_messages")
        .select("dm_channel_id, content, created_at, sender_id")
        .in("dm_channel_id", channelIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(channelIds.length * 5),
      supabase
        .from("dm_read_states")
        .select("dm_channel_id, last_read_at")
        .eq("user_id", user.id)
        .in("dm_channel_id", channelIds),
    ])

    if (channelResult.error) return NextResponse.json({ error: "Failed to fetch DM channels" }, { status: 500 })
    if (memberResult.error) return NextResponse.json({ error: "Failed to fetch channel members" }, { status: 500 })
    if (latestResult.error) return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
    if (readsResult.error) return NextResponse.json({ error: "Failed to fetch read states" }, { status: 500 })

    const channelRows = channelResult.data
    const allMemberRows = memberResult.data

    // Fetch user profiles for all unique member IDs
    const allUserIds = Array.from(new Set((allMemberRows ?? []).map((m) => m.user_id)))
    const userRowsQuery = allUserIds.length
      ? await supabase
          .from("users")
          .select("id, username, display_name, avatar_url, status, status_message")
          .in("id", allUserIds)
      : null
    const userRows = userRowsQuery?.data ?? []
    if (userRowsQuery?.error) return NextResponse.json({ error: "Failed to fetch user profiles" }, { status: 500 })

    const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))

    // Build members-per-channel map
    const membersByChannel: Record<string, typeof userRows> = {}
    for (const row of allMemberRows ?? []) {
      if (!membersByChannel[row.dm_channel_id]) membersByChannel[row.dm_channel_id] = []
      const u = userMap[row.user_id]
      if (u) membersByChannel[row.dm_channel_id]!.push(u)
    }

    const latestMessages: Record<string, Record<string, unknown>> = {}
    for (const msg of latestResult.data ?? []) {
      if (msg.dm_channel_id && !latestMessages[msg.dm_channel_id]) {
        latestMessages[msg.dm_channel_id] = msg
      }
    }

    const readStates: Record<string, string> = {}
    for (const r of readsResult.data ?? []) {
      readStates[r.dm_channel_id] = r.last_read_at
    }

    // 7. Assemble result
    const channels = (channelRows ?? []).map((ch) => {
      const members = membersByChannel[ch.id] ?? []
      const partner = ch.is_group ? null : (members.find((u) => u.id !== user.id) ?? null)
      const latest = latestMessages[ch.id] ?? null
      const lastRead = readStates[ch.id]
      const isUnread = !!(latest && (!lastRead || (latest.created_at as string) > lastRead) && latest.sender_id !== user.id)

      return {
        id: ch.id,
        name: ch.name,
        icon_url: ch.icon_url,
        is_group: ch.is_group,
        owner_id: ch.owner_id,
        updated_at: ch.updated_at,
        is_encrypted: ch.is_encrypted,
        members,
        partner,
        latest_message: latest ? { ...latest, content: ch.is_encrypted ? "Encrypted message" : latest.content } : null,
        is_unread: isUnread,
      }
    })

    channels.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

    return NextResponse.json(channels, {
      headers: { "Cache-Control": "private, max-age=5" },
    })
  } catch (err) {
    console.error("[dm/channels GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/dm/channels — open/create a DM channel
// Body: { userIds: string[], name?: string } (userIds = partner(s), name for group)
export async function POST(req: NextRequest) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "dm:create", { limit: 20, windowMs: 3600_000 })
    if (limited) return limited

    const { data: parsedBody, error: parseError } = await parseJsonBody<{ userIds?: string[]; name?: string; encrypted?: boolean }>(req)
    if (parseError) return parseError

    const { userIds, name } = parsedBody
    const encrypted = parsedBody.encrypted === true
    if (!userIds?.length) return NextResponse.json({ error: "userIds required" }, { status: 400 })

    const allMembers = Array.from(new Set([user.id, ...userIds])) as string[]
    const isGroup = allMembers.length > 2

    if (!isGroup) {
      const partnerId = userIds[0] as string

      // Find existing 1:1 channel between current user and partner — fetch in parallel
      const [
        { data: userMems, error: userMemsError },
        { data: partnerMems, error: partnerMemsError },
      ] = await Promise.all([
        supabase
          .from("dm_channel_members")
          .select("dm_channel_id")
          .eq("user_id", user.id),
        supabase
          .from("dm_channel_members")
          .select("dm_channel_id")
          .eq("user_id", partnerId),
      ])
      if (userMemsError) return NextResponse.json({ error: "Failed to check existing channels" }, { status: 500 })
      if (partnerMemsError) return NextResponse.json({ error: "Failed to check existing channels" }, { status: 500 })

      const userChannelIds = new Set((userMems ?? []).map((m) => m.dm_channel_id))
      const sharedChannelIds = (partnerMems ?? [])
        .map((m) => m.dm_channel_id)
        .filter((id) => userChannelIds.has(id))

      if (sharedChannelIds.length > 0) {
        // Get non-group channels from those IDs
        const { data: nonGroupChannels, error: nonGroupChannelsError } = await supabase
          .from("dm_channels")
          .select("id, is_encrypted")
          .in("id", sharedChannelIds)
          .eq("is_group", false)
          .eq("is_encrypted", encrypted)
        if (nonGroupChannelsError) return NextResponse.json({ error: "Failed to check existing channels" }, { status: 500 })

        const existingChannel = (nonGroupChannels ?? [])[0]
        if (existingChannel) {
          return NextResponse.json({ id: existingChannel.id, existing: true })
        }
      }
    }

    // Create new channel
    const { data: channel, error: chanErr } = await supabase
      .from("dm_channels")
      .insert({ name: name ?? null, is_group: isGroup, owner_id: user.id, is_encrypted: encrypted })
      .select()
      .single()

    if (chanErr) return NextResponse.json({ error: "Failed to create DM channel" }, { status: 500 })

    // Add all members
    const memberRows = allMembers.map((uid) => ({
      dm_channel_id: channel.id,
      user_id: uid,
      added_by: user.id,
    }))

    const { error: memErr } = await supabase
      .from("dm_channel_members")
      .insert(memberRows)

    if (memErr) {
      await supabase.from("dm_channels").delete().eq("id", channel.id)
      return NextResponse.json({ error: "Failed to create DM channel" }, { status: 500 })
    }

    return NextResponse.json({ id: channel.id, existing: false }, { status: 201 })
  } catch (err) {
    console.error("[dm/channels POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
