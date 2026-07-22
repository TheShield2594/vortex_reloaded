import { notFound, redirect } from "next/navigation"
import { createServerSupabaseClient, getAuthUser } from "@/lib/supabase/server"
import { ChatArea } from "@/components/chat/chat-area"
import { AnnouncementChannel } from "@/components/channels/announcement-channel"
import { ForumChannel } from "@/components/channels/forum-channel"
import { MediaChannel } from "@/components/channels/media-channel"
import { VoiceChannelLazy as VoiceChannel } from "@/components/voice/voice-channel-lazy"
import { hydrateReplyTo, MESSAGE_PROJECTION } from "@/lib/messages/hydration"
import { PERMISSIONS, computePermissions, hasPermission } from "@vortex/shared"
import type { RoleRow, MessageWithAuthor } from "@/types/database"
import { perfTimer } from "@/lib/perf"

interface Props {
  params: Promise<{ serverId: string; channelId: string }>
}

/** Channel types that store messages in the messages table */
const MESSAGE_CHANNEL_TYPES = ["text", "announcement", "forum", "media"] as const

/** Channel types that use voice/WebRTC infrastructure */
const VOICE_CHANNEL_TYPES = ["voice", "stage"] as const

/** Server-rendered channel page that fetches channel data, messages, and read-state, then delegates to the appropriate channel-type component. */
export default async function ChannelPage({ params: paramsPromise }: Props) {
  const params = await paramsPromise
  const pageTimer = perfTimer(`channel-page total [${params.channelId.slice(0, 8)}]`)

  const [supabase, { data: { user }, error }] = await Promise.all([
    createServerSupabaseClient(),
    getAuthUser(),
  ])

  if (error || !user) redirect("/login")

  // Fetch channel, messages, read-state, server ownership, member roles, default role,
  // and channel permission overrides — ALL in one parallel block.
  // Previously getChannelPermissions() ran sequentially after this block and re-queried
  // server ownership + member_roles (5 redundant queries eliminated).
  const queryTimer = perfTimer("channel-page queries")
  const [
    { data: channel },
    { data: messagesData },
    { data: readState },
    { data: server },
    { data: memberRoles },
    { data: defaultRole },
    { data: channelOverwrites },
  ] = await Promise.all([
    supabase
      .from("channels")
      .select("*")
      .eq("id", params.channelId)
      .eq("server_id", params.serverId)
      .single(),
    supabase
      .from("messages")
      .select(MESSAGE_PROJECTION)
      .eq("channel_id", params.channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("read_states")
      .select("last_read_at")
      .eq("user_id", user.id)
      .eq("channel_id", params.channelId)
      .maybeSingle(),
    supabase
      .from("servers")
      .select("owner_id")
      .eq("id", params.serverId)
      .single(),
    supabase
      .from("member_roles")
      .select("role_id, roles(*)")
      .eq("server_id", params.serverId)
      .eq("user_id", user.id),
    supabase
      .from("roles")
      .select("id")
      .eq("server_id", params.serverId)
      .eq("is_default", true)
      .maybeSingle(),
    supabase
      .from("channel_permissions")
      .select("role_id, allow_permissions, deny_permissions")
      .eq("channel_id", params.channelId),
  ])

  queryTimer.end()

  if (!channel) notFound()

  // Compute permissions synchronously from the already-fetched data
  const isOwner = server?.owner_id === user.id
  type MemberRoleWithRole = { role_id: string; roles: RoleRow | null }
  const typedMemberRoles = (memberRoles ?? []) as unknown as MemberRoleWithRole[]
  const roleBitmasks = typedMemberRoles.map((mr) => mr.roles?.permissions ?? 0)
  const effectivePerms = computePermissions(roleBitmasks)
  const isAdmin = isOwner || !!(effectivePerms & PERMISSIONS.ADMINISTRATOR)
  const canManageMessages = isOwner || hasPermission(effectivePerms, "MANAGE_MESSAGES")

  // Apply channel-level permission overwrites (deny first, then allow)
  let channelPerms = effectivePerms
  if (!isAdmin) {
    const roleIds = new Set(typedMemberRoles.map((mr) => mr.role_id))
    if (defaultRole?.id) roleIds.add(defaultRole.id)
    if (roleIds.size > 0) {
      const relevant = (channelOverwrites ?? []).filter((row) => roleIds.has(row.role_id))
      const denyMask = relevant.reduce((acc, row) => acc | (row.deny_permissions ?? 0), 0)
      const allowMask = relevant.reduce((acc, row) => acc | (row.allow_permissions ?? 0), 0)
      channelPerms = (effectivePerms & ~denyMask) | allowMask
    }
  }

  const canSendMessages = isAdmin || hasPermission(channelPerms, "SEND_MESSAGES")
  const canAttachMedia = canSendMessages
  const canConnectVoice = isAdmin || hasPermission(channelPerms, "CONNECT_VOICE")
  const canSpeakOnStage = isAdmin || hasPermission(channelPerms, "SPEAK")
  const canModerateStage = isAdmin || hasPermission(channelPerms, "MUTE_MEMBERS")

  // Filter messages to only text-based channel types
  let messages: MessageWithAuthor[] = []
  if ((MESSAGE_CHANNEL_TYPES as readonly string[]).includes(channel.type)) {
    const hydrateTimer = perfTimer("channel-page reply hydration")
    const raw = (messagesData ?? []).reverse()
    messages = await hydrateReplyTo(supabase, raw) as unknown as MessageWithAuthor[]
    hydrateTimer.end()
  }

  pageTimer.end()

  // Voice and Stage channels use the WebRTC voice infrastructure
  if ((VOICE_CHANNEL_TYPES as readonly string[]).includes(channel.type)) {
    return (
      <div className="flex flex-1 overflow-hidden">
        <VoiceChannel
          channelId={channel.id}
          channelName={channel.name}
          serverId={params.serverId}
          currentUserId={user.id}
          isStage={channel.type === "stage"}
          stageStreamUrl={channel.stream_url}
          canConnect={canConnectVoice}
          canSpeak={canSpeakOnStage}
          canModerate={canModerateStage}
        />
      </div>
    )
  }

  // Announcement channels
  if (channel.type === "announcement") {
    return (
      <div className="flex flex-1 overflow-hidden">
        <AnnouncementChannel
          channel={channel}
          initialMessages={messages}
          currentUserId={user.id}
          serverId={params.serverId}
        />
      </div>
    )
  }

  // Forum channels
  if (channel.type === "forum") {
    return (
      <div className="flex flex-1 overflow-hidden">
        <ForumChannel
          channel={channel}
          initialMessages={messages}
          currentUserId={user.id}
          serverId={params.serverId}
          canSendMessages={canSendMessages}
        />
      </div>
    )
  }

  // Media channels
  if (channel.type === "media") {
    return (
      <div className="flex flex-1 overflow-hidden">
        <MediaChannel
          channel={channel}
          initialMessages={messages}
          currentUserId={user.id}
          serverId={params.serverId}
          canSendMessages={canSendMessages}
          requireMediaAttachments={canAttachMedia}
        />
      </div>
    )
  }

  // Default: text channel
  const initialLastReadAt = readState?.last_read_at ?? null

  return (
    <div className="flex flex-1 overflow-hidden">
      <ChatArea
        key={channel.id}
        channel={channel}
        initialMessages={messages}
        currentUserId={user.id}
        serverId={params.serverId}
        initialLastReadAt={initialLastReadAt}
        canManageMessages={canManageMessages}
      />
    </div>
  )
}
