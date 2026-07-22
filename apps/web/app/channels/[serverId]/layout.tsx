import { Suspense } from "react"
import { redirect, notFound } from "next/navigation"
import { createServerSupabaseClient, createServiceRoleClient, getAuthUser } from "@/lib/supabase/server"
import { ChannelSidebar } from "@/components/layout/channel-sidebar"
import type { VoiceParticipant } from "@/components/layout/channel-sidebar"
import { MemberList } from "@/components/layout/member-list"
import { ServerEmojiProvider } from "@/components/chat/server-emoji-context"
import { ServerMobileLayout } from "@/components/layout/server-mobile-layout"
import type { RoleRow } from "@/types/database"
import type { MemberData } from "@/components/layout/member-list"
import { MessageListSkeleton } from "@/components/ui/skeleton"
import { perfTimer } from "@/lib/perf"

interface Props {
  children: React.ReactNode
  params: Promise<{ serverId: string }>
}

/** Server-rendered layout that verifies membership and renders the channel sidebar alongside the active channel. */
export default async function ServerLayout({ children, params: paramsPromise }: Props) {
  const layoutTimer = perfTimer(`server-layout total [${(await paramsPromise).serverId.slice(0, 8)}]`)
  const params = await paramsPromise

  const authTimer = perfTimer("server-layout auth")
  const [supabase, { data: { user }, error }] = await Promise.all([
    createServerSupabaseClient(),
    getAuthUser(),
  ])
  authTimer.end()

  if (error || !user) redirect("/login")

  // Fetch membership, server, channels, and roles in parallel
  const round1Timer = perfTimer("server-layout round-1 (member/server/channels/roles)")
  const [{ data: member }, { data: server }, { data: channels }, { data: memberRoles }] = await Promise.all([
    supabase.from("server_members").select("server_id").eq("server_id", params.serverId).eq("user_id", user.id).single(),
    supabase.from("servers").select("*").eq("id", params.serverId).single(),
    supabase.from("channels").select("*").eq("server_id", params.serverId).order("position", { ascending: true }),
    supabase.from("member_roles").select("role_id, roles(*)").eq("server_id", params.serverId).eq("user_id", user.id),
  ])

  round1Timer.end()

  if (!server) notFound()
  if (!member) notFound()

  type MemberRoleWithRole = { role_id: string; roles: RoleRow | null }
  const userRoles = ((memberRoles ?? []) as unknown as MemberRoleWithRole[])
    .map((mr) => mr.roles)
    .filter((r): r is RoleRow => r !== null)

  // Compute text channel IDs for unread queries
  const allChannels = channels ?? []
  const textChannelIds = allChannels
    .filter((c) => c.type === "text")
    .map((c) => c.id)

  // Fetch 5 additional data sources in parallel for SSR hydration
  const round2Timer = perfTimer("server-layout round-2 (members/emojis/threads/voice/reads/messages)")
  const adminSupabase = await createServiceRoleClient()

  // Members query with fallback for missing last_online_at column
  async function fetchMembersWithFallback() {
    const full = await adminSupabase.from("server_members")
      .select(`
        server_id, user_id, nickname,
        user:users!server_members_user_id_fkey(
          id, username, display_name, avatar_url, status_message,
          bio, banner_color, custom_tag, game_activity, created_at, last_online_at
        ),
        roles:member_roles(role_id, roles(id, server_id, name, color, permissions, position, created_at))
      `)
      .eq("server_id", params.serverId)
      .order("nickname", { ascending: true, nullsFirst: false })
      .order("user_id", { ascending: true })
    if (!full.error) return full
    // Retry without last_online_at if column doesn't exist yet
    console.warn("[server-layout] Members query failed, retrying without last_online_at", {
      serverId: params.serverId,
      code: full.error.code,
      message: full.error.message,
    })
    const compat = await adminSupabase.from("server_members")
      .select(`
        server_id, user_id, nickname,
        user:users!server_members_user_id_fkey(
          id, username, display_name, avatar_url, status_message,
          bio, banner_color, custom_tag, created_at
        ),
        roles:member_roles(role_id, roles(id, server_id, name, color, permissions, position, created_at))
      `)
      .eq("server_id", params.serverId)
      .order("nickname", { ascending: true, nullsFirst: false })
      .order("user_id", { ascending: true })
    // Normalize: add missing fields so downstream MemberData type is satisfied
    if (compat.data) {
      for (const member of compat.data) {
        if (typeof member.user === "object" && member.user !== null) {
          const u = member.user
          if (!("last_online_at" in u)) Object.assign(u, { last_online_at: null })
          if (!("game_activity" in u)) Object.assign(u, { game_activity: null })
        }
      }
    }
    return compat as unknown as typeof full
  }

  const [
    { data: rawMembers },
    { data: emojis },
    { data: threadCountRows },
    { data: voiceStateRows },
    { data: readStates },
    { data: latestMessages },
  ] = await Promise.all([
    // Members (via service role to bypass RLS)
    fetchMembersWithFallback(),
    // Emojis
    supabase
      .from("server_emojis")
      .select("id, name, image_url")
      .eq("server_id", params.serverId)
      .order("name"),
    // Thread counts
    supabase.rpc("get_thread_counts_by_channel", { p_server_id: params.serverId }),
    // Voice states
    supabase
      .from("voice_states")
      .select("user_id, channel_id, muted, deafened, users(id, username, display_name, avatar_url)")
      .eq("server_id", params.serverId),
    // Read states
    textChannelIds.length > 0
      ? supabase
          .from("read_states")
          .select("channel_id, last_read_at, mention_count")
          .eq("user_id", user.id)
          .in("channel_id", textChannelIds)
      : Promise.resolve({ data: [] as { channel_id: string; last_read_at: string; mention_count: number }[] }),
    // Latest messages per text channel — limit to avoid fetching entire history
    textChannelIds.length > 0
      ? supabase
          .from("messages")
          .select("channel_id, created_at")
          .in("channel_id", textChannelIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(textChannelIds.length * 5)
      : Promise.resolve({ data: [] as { channel_id: string; created_at: string }[] }),
  ])

  round2Timer.end()

  // Normalize members: flatten nested roles
  type ApiRoleEntry = { role_id: string; roles: RoleRow | null }
  type ApiMember = Omit<MemberData, "roles"> & { roles?: ApiRoleEntry[] }
  const initialMembers: MemberData[] = ((rawMembers ?? []) as unknown as ApiMember[]).map((m) => ({
    ...m,
    roles: (m.roles ?? [])
      .map((entry) => entry.roles)
      .filter((role): role is RoleRow => Boolean(role)),
  }))

  // Normalize thread counts: RPC returns { parent_channel_id, count }[]
  const initialThreadCounts: Record<string, number> = {}
  for (const row of (threadCountRows ?? []) as { parent_channel_id: string; count: number }[]) {
    initialThreadCounts[row.parent_channel_id] = Number(row.count)
  }

  // Normalize voice states
  interface VoiceStateRow {
    user_id: string
    channel_id: string
    muted: boolean
    deafened: boolean
    users: VoiceParticipant["user"] | null
  }
  const initialVoiceParticipants: VoiceParticipant[] = ((voiceStateRows as unknown as VoiceStateRow[]) ?? []).map((d) => ({
    user_id: d.user_id,
    channel_id: d.channel_id,
    muted: d.muted,
    deafened: d.deafened,
    user: d.users ?? null,
  }))

  // Compute unread channels and mention counts
  const readMap: Record<string, string> = {}
  const initialMentionCounts: Record<string, number> = {}
  for (const rs of (readStates ?? []) as { channel_id: string; last_read_at: string; mention_count: number }[]) {
    readMap[rs.channel_id] = rs.last_read_at
    if (rs.mention_count > 0) initialMentionCounts[rs.channel_id] = rs.mention_count
  }

  const initialUnreadChannelIds: string[] = []
  if (Object.keys(readMap).length > 0) {
    const latestPerChannel: Record<string, string> = {}
    for (const msg of (latestMessages ?? []) as { channel_id: string; created_at: string }[]) {
      if (!latestPerChannel[msg.channel_id]) {
        latestPerChannel[msg.channel_id] = msg.created_at
      }
    }
    for (const channelId of Object.keys(readMap)) {
      const latest = latestPerChannel[channelId]
      const lastRead = readMap[channelId]
      if (latest && latest > lastRead) {
        initialUnreadChannelIds.push(channelId)
      }
    }
  }

  layoutTimer.end()

  return (
    <ServerEmojiProvider serverId={params.serverId} initialEmojis={emojis ?? []}>
      <ServerMobileLayout
        serverId={params.serverId}
        sidebar={
          <ChannelSidebar
            key={`sidebar-${params.serverId}`}
            server={server}
            channels={allChannels}
            currentUserId={user.id}
            isOwner={server.owner_id === user.id}
            userRoles={userRoles}
            initialThreadCounts={initialThreadCounts}
            initialVoiceParticipants={initialVoiceParticipants}
            initialUnreadChannelIds={initialUnreadChannelIds}
            initialMentionCounts={initialMentionCounts}
          />
        }
        memberList={
          <MemberList key={`members-${params.serverId}`} serverId={params.serverId} initialMembers={initialMembers} />
        }
      >
        <Suspense fallback={
          <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
            <div
              className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
              style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)" }}
            >
              <div className="skeleton-shimmer h-4 w-4 rounded" aria-hidden="true" />
              <div className="skeleton-shimmer h-4 w-32 rounded" aria-hidden="true" />
            </div>
            <div className="flex-1 overflow-hidden">
              <MessageListSkeleton count={8} />
            </div>
          </div>
        }>
          {children}
        </Suspense>
      </ServerMobileLayout>
    </ServerEmojiProvider>
  )
}
