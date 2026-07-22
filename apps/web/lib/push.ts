import webpush from "web-push"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveNotification } from "@/lib/notification-resolver"
import { isInQuietHours } from "@/lib/quiet-hours"
import { PERMISSIONS } from "@vortex/shared"

// VAPID keys — set these env vars (generate once with: npx web-push generate-vapid-keys)
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ""
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@vortexchat.app"

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured || !VAPID_PUBLIC || !VAPID_PRIVATE) return
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  vapidConfigured = true
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
}

// Push TTL — how long (in seconds) the push service should retain an
// undelivered notification.  Mobile devices in doze / low-power mode may
// not be reachable immediately, so we use 24 hours to avoid silent drops.
const PUSH_TTL_SECONDS = 86_400 // 24 hours

// Urgency — Apple's APNs maps the Web Push Urgency header to apns-priority.
// Without "high", iOS treats notifications as low/normal priority and may
// delay, batch, or silently drop them — especially when the device is locked
// or in low-power mode.  "high" maps to apns-priority 10 (immediate delivery).
const PUSH_URGENCY = "high" as const

/**
 * Send a push notification to all subscriptions for a given user.
 * Silently removes stale subscriptions (410 Gone).
 *
 * We no longer filter by DB-level "online" status because it is unreliable
 * on mobile PWAs — iOS/Android keep WebSocket connections alive after the
 * app is backgrounded, so users appear "online" when they're not looking.
 * Notifications are always delivered; the user sees them whether the app
 * is open or not (matching Discord/Slack behavior).
 *
 * @param skipQuietHours  Pass `true` when quiet-hours were already checked
 *                        by the caller (e.g. sendPushToChannel batch path).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  { skipQuietHours = false }: { skipQuietHours?: boolean } = {}
): Promise<void> {
  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.warn("sendPushToUser: VAPID keys not configured — push notifications disabled")
      return
    }
    ensureVapid()

    const supabase = await createServerSupabaseClient()

    // Check quiet hours — suppress push if the user is in their scheduled DND window
    if (!skipQuietHours) {
      const { data: quietPrefs, error: quietError } = await supabase
        .from("user_notification_preferences")
        .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone")
        .eq("user_id", userId)
        .maybeSingle()

      if (quietError) {
        console.error("Failed to fetch quiet hours preferences:", quietError.message)
        // Continue sending — fail open rather than suppressing notifications
      }

      if (quietPrefs && isInQuietHours(
        quietPrefs.quiet_hours_enabled,
        quietPrefs.quiet_hours_start,
        quietPrefs.quiet_hours_end,
        quietPrefs.quiet_hours_timezone,
      )) {
        return // suppress during quiet hours
      }
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId)

    if (!subs?.length) return

    const results = await Promise.allSettled(
      subs.map((sub: { id: string; endpoint: string; p256dh: string; auth: string }) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: PUSH_TTL_SECONDS, urgency: PUSH_URGENCY }
        ).catch(async (err: unknown) => {
          const statusCode = (err as { statusCode?: number }).statusCode
          // 410 = subscription expired; clean it up
          if (statusCode === 410 || statusCode === 404) {
            const { error: deleteError } = await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id)
            if (deleteError) {
              console.error(`sendPushToUser: failed to remove stale subscription ${sub.id}`, deleteError)
            }
          } else {
            console.error(`sendPushToUser: push to ${sub.endpoint.slice(0, 50)}… failed`, statusCode ?? err)
          }
          throw err // re-throw so allSettled marks as rejected
        })
      )
    )

    // Warn when ALL subscriptions failed — likely iOS SW eviction or stale endpoints
    const allFailed = results.every((r) => r.status === "rejected")
    if (allFailed) {
      console.warn(`sendPushToUser: all ${subs.length} push subscriptions failed for user ${userId} — possible iOS service worker eviction`)
    }
  } catch (err) {
    console.error("sendPushToUser: unexpected error", err)
  }
}

/**
 * Send a push notification to all members of a channel except the sender.
 * Respects notification_settings (muted/mentions-only) when channelId + mentionedIds provided.
 */
export async function sendPushToChannel(opts: {
  serverId?: string
  channelId?: string
  threadId?: string
  dmChannelId?: string
  senderName: string
  senderAvatarUrl?: string | null
  content: string
  mentionedIds?: string[]
  mentionEveryone?: boolean
  mentionedRoleIds?: string[]
  excludeUserId: string
}): Promise<void> {
  try {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn("sendPushToChannel: VAPID keys not configured — push notifications disabled")
    return
  }
  ensureVapid()

  const { serverId, channelId, threadId, dmChannelId, senderName, senderAvatarUrl, content, mentionedIds = [], mentionEveryone = false, mentionedRoleIds = [], excludeUserId } = opts
  const mentionedSet = new Set(mentionedIds)
  const supabase = await createServerSupabaseClient()

  let memberIds: string[] = []

  if (dmChannelId) {
    const { data: members } = await supabase
      .from("dm_channel_members")
      .select("user_id")
      .eq("dm_channel_id", dmChannelId)
      .neq("user_id", excludeUserId)
    memberIds = members?.map((m: { user_id: string }) => m.user_id) ?? []
  } else if (threadId) {
    const { data: members } = await supabase
      .from("thread_members")
      .select("user_id")
      .eq("thread_id", threadId)
      .neq("user_id", excludeUserId)
    memberIds = members?.map((m: { user_id: string }) => m.user_id) ?? []
  } else if (serverId && channelId) {
    const { data: members } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .neq("user_id", excludeUserId)
    const allMemberIds = members?.map((m: { user_id: string }) => m.user_id) ?? []

    // Filter out members whose roles are denied VIEW_CHANNELS on this channel
    const { data: overrides } = await supabase
      .from("channel_permissions")
      .select("role_id, allow_permissions, deny_permissions")
      .eq("channel_id", channelId)

    interface ChannelPermOverride { role_id: string; allow_permissions: number; deny_permissions: number }

    if (overrides && overrides.length > 0) {
      const typedOverrides = overrides as ChannelPermOverride[]
      const denyViewRoleIds = new Set(
        typedOverrides
          .filter((o) => (o.deny_permissions & PERMISSIONS.VIEW_CHANNELS) !== 0)
          .map((o) => o.role_id)
      )
      const allowViewRoleIds = new Set(
        typedOverrides
          .filter((o) => (o.allow_permissions & PERMISSIONS.VIEW_CHANNELS) !== 0)
          .map((o) => o.role_id)
      )

      // Only filter if there are deny overrides for VIEW_CHANNELS
      if (denyViewRoleIds.size > 0) {
        // Fetch server owner (always has access)
        const { data: server } = await supabase
          .from("servers")
          .select("owner_id")
          .eq("id", serverId)
          .maybeSingle()
        const ownerId = server?.owner_id

        // Fetch each member's roles to check access
        const { data: memberRoles } = await supabase
          .from("member_roles")
          .select("user_id, roles(id, permissions)")
          .eq("server_id", serverId)
          .in("user_id", allMemberIds)

        // Fetch default @everyone role
        const { data: defaultRole } = await supabase
          .from("roles")
          .select("id, permissions")
          .eq("server_id", serverId)
          .eq("is_default", true)
          .maybeSingle()

        // Build a map of user -> role IDs and combined permissions
        const memberRoleMap = new Map<string, { roleIds: Set<string>; permissions: number }>()
        for (const uid of allMemberIds) {
          memberRoleMap.set(uid, {
            roleIds: new Set(defaultRole ? [defaultRole.id] : []),
            permissions: defaultRole?.permissions ?? 0,
          })
        }
        for (const mr of memberRoles ?? []) {
          const entry = memberRoleMap.get(mr.user_id)
          if (!entry) continue
          const role = mr.roles as unknown as { id: string; permissions: number } | null
          if (role) {
            entry.roleIds.add(role.id)
            entry.permissions = entry.permissions | role.permissions
          }
        }

        memberIds = allMemberIds.filter((uid: string) => {
          // Owner and admins always have access
          if (uid === ownerId) return true
          const entry = memberRoleMap.get(uid)
          if (!entry) return false
          if (entry.permissions & PERMISSIONS.ADMINISTRATOR) return true

          // Apply channel overrides: deny first, then allow
          const userRoleIds = entry.roleIds
          const isDenied = [...userRoleIds].some((rid) => denyViewRoleIds.has(rid))
          const isAllowed = [...userRoleIds].some((rid) => allowViewRoleIds.has(rid))
          // If any role is explicitly allowed, it overrides the deny
          if (isDenied && !isAllowed) return false
          return true
        })
      } else {
        memberIds = allMemberIds
      }
    } else {
      memberIds = allMemberIds
    }
  }

  if (!memberIds.length) return

  // NOTE: We intentionally do NOT filter out "online" users here.
  // Mobile PWA users (iOS/Android) keep WebSocket connections alive when
  // the app is backgrounded, so their DB status reads "online" even when
  // they aren't looking at the app.  The service worker always displays
  // notifications (required by iOS); no client-side focused-window
  // suppression is performed.  Filtering server-side was causing ALL
  // mobile push notifications to be silently dropped.

  // ── Batch quiet-hours check ──────────────────────────────────────
  // Filter out members who are in their scheduled DND window so we
  // don't need per-user quiet-hours queries in sendPushToUser.
  const { data: quietHoursPrefs, error: quietHoursError } = await supabase
    .from("user_notification_preferences")
    .select("user_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone")
    .in("user_id", memberIds)
    .eq("quiet_hours_enabled", true)

  if (quietHoursError) {
    // Fail open — deliver notifications rather than silently suppressing
    console.error("sendPushToChannel: failed to fetch quiet hours", {
      action: "batch-quiet-hours",
      recipientCount: memberIds.length,
      channelId,
      threadId,
      dmChannelId,
      error: quietHoursError.message,
    })
  } else if (quietHoursPrefs?.length) {
    const quietUserIds = new Set(
      quietHoursPrefs
        .filter((p: { user_id: string; quiet_hours_enabled: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null; quiet_hours_timezone: string | null }) =>
          isInQuietHours(p.quiet_hours_enabled, p.quiet_hours_start, p.quiet_hours_end, p.quiet_hours_timezone)
        )
        .map((p: { user_id: string }) => p.user_id)
    )
    if (quietUserIds.size > 0) {
      memberIds = memberIds.filter((uid: string) => !quietUserIds.has(uid))
    }
  }

  if (!memberIds.length) return

    // Fetch all relevant notification settings in parallel instead of sequentially
  type SettingsRow = { user_id: string; mode: "all" | "mentions" | "muted"; server_id?: string | null; channel_id?: string | null; thread_id?: string | null }
  const settingsQueries: Array<PromiseLike<{ data: SettingsRow[] | null }>> = []

  const handleSettingsResult = (r: { data: unknown[] | null; error: { message: string } | null }, scope: string): { data: SettingsRow[] } => {
    if (r.error) {
      console.error("sendPushToChannel: failed to fetch settings", { action: "batch-settings", scope, recipientCount: memberIds.length, error: r.error.message })
    }
    return { data: (r.data ?? []) as SettingsRow[] }
  }

  if (threadId) {
    settingsQueries.push(
      supabase.from("notification_settings").select("user_id, mode, server_id, channel_id, thread_id").in("user_id", memberIds).eq("thread_id", threadId)
        .then((r) => handleSettingsResult(r, "thread"))
    )
  }

  if (channelId) {
    settingsQueries.push(
      supabase.from("notification_settings").select("user_id, mode, server_id, channel_id, thread_id").in("user_id", memberIds).eq("channel_id", channelId)
        .then((r) => handleSettingsResult(r, "channel"))
    )
  }

  if (serverId) {
    settingsQueries.push(
      supabase.from("notification_settings").select("user_id, mode, server_id, channel_id, thread_id").in("user_id", memberIds).eq("server_id", serverId)
        .then((r) => handleSettingsResult(r, "server"))
    )
  }

  settingsQueries.push(
    supabase.from("notification_settings").select("user_id, mode, server_id, channel_id, thread_id").in("user_id", memberIds).is("server_id", null).is("channel_id", null).is("thread_id", null)
      .then((r) => handleSettingsResult(r, "global"))
  )

  const settingsResults = await Promise.all(settingsQueries)
  const settingsBatches = settingsResults.map((r) => r.data ?? [])

  const settings = settingsBatches.flat()

  // Fetch global notification type preferences so mention opt-outs and
  // @everyone/@role suppression are respected (#607)
  const { data: globalTypePrefs, error: globalTypePrefsError } = await supabase
    .from("user_notification_preferences")
    .select("user_id, mention_notifications, suppress_everyone, suppress_role_mentions")
    .in("user_id", memberIds)
  if (globalTypePrefsError) {
    console.error("sendPushToChannel: failed to fetch type preferences", { action: "type-prefs", recipientCount: memberIds.length, error: globalTypePrefsError.message })
  }
  interface TypePref { user_id: string; mention_notifications: boolean | null; suppress_everyone: boolean | null; suppress_role_mentions: boolean | null }
  const globalTypePrefMap = new Map<string, TypePref>(
    (globalTypePrefs ?? []).map((p: TypePref) => [p.user_id, p])
  )

  // ── Build notification title with server/channel context (#602) ───
  // Server channels: "ServerName — #channel" (or "… — #channel > Thread")
  // DMs: just the sender name (unchanged)
  let notificationTitle = senderName
  let notificationBody = content.length > 100 ? content.slice(0, 97) + "…" : content

  if (serverId && channelId) {
    // Fetch server + channel names in a single parallel query
    const [serverResult, channelResult] = await Promise.all([
      supabase.from("servers").select("name").eq("id", serverId).maybeSingle(),
      supabase.from("channels").select("name").eq("id", channelId).maybeSingle(),
    ])
    const serverName = serverResult.data?.name
    const channelName = channelResult.data?.name

    if (serverName && channelName) {
      if (threadId) {
        // Fetch thread name if available
        const { data: threadData } = await supabase
          .from("threads")
          .select("name")
          .eq("id", threadId)
          .maybeSingle()
        const threadName = threadData?.name
        notificationTitle = threadName
          ? `${serverName} — #${channelName} > ${threadName}`.slice(0, 60)
          : `${serverName} — #${channelName} > Thread`.slice(0, 60)
      } else {
        notificationTitle = `${serverName} — #${channelName}`.slice(0, 60)
      }
      // Prefix body with sender name since title no longer contains it
      notificationBody = `${senderName}: ${notificationBody}`
    }
  }

  // Use sender's avatar for the notification icon; fall back to the app icon
  // for system notifications or when no avatar is available (#606)
  const notificationIcon = senderAvatarUrl || "/icon-192.png"

  const payload: PushPayload = {
    title: notificationTitle,
    body: notificationBody,
    url: channelId && serverId
      ? `/channels/${serverId}/${channelId}${threadId ? `?thread=${threadId}` : ""}`
      : dmChannelId
      ? `/channels/me/${dmChannelId}`
      : "/channels/me",
    tag: threadId ?? channelId ?? dmChannelId ?? "message",
    icon: notificationIcon,
  }

  // Build a set of role IDs mentioned in this message for @role suppression (#607)
  const mentionedRoleIdSet = new Set(mentionedRoleIds)

  await Promise.allSettled(
    memberIds.map((uid) => {
      // Determine if this user was mentioned via @everyone or @role
      const isMentionedByEveryone = mentionEveryone
      const isMentionedByRole = mentionedRoleIdSet.size > 0 && !mentionedSet.has(uid) && isMentionedByEveryone === false
      const eventType = (isMentionedByEveryone || mentionedSet.has(uid) || isMentionedByRole) ? "mention" : "message"
      const resolved = resolveNotification(
        uid,
        serverId ?? null,
        channelId ?? null,
        threadId ?? null,
        eventType,
        (settings ?? []) as Array<{ user_id: string; mode: "all" | "mentions" | "muted"; server_id?: string | null; channel_id?: string | null; thread_id?: string | null }>
      )

      if (!resolved.shouldPush) return

      // Respect global mention opt-out even when channel mode allows it
      const typePrefs = globalTypePrefMap.get(uid)
      if (eventType === "mention") {
        if (typePrefs && typePrefs.mention_notifications === false) return
      }

      // Suppress @everyone mentions if user has opted out (#607)
      if (isMentionedByEveryone && !mentionedSet.has(uid)) {
        if (typePrefs?.suppress_everyone === true) return
      }

      // Suppress @role mentions if user has opted out (#607)
      if (isMentionedByRole) {
        if (typePrefs?.suppress_role_mentions === true) return
      }

      return sendPushToUser(uid, payload, { skipQuietHours: true })
    })
  )
  } catch (err) {
    console.error("sendPushToChannel: unexpected error", err)
  }
}
