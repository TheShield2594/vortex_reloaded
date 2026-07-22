import webpush from "web-push"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveNotification } from "@/lib/notification-resolver"
import { isInQuietHours } from "@/lib/quiet-hours"

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
 * Send a push notification to all other members of a DM/group channel.
 * Respects notification_settings (muted/mentions-only) and quiet hours.
 */
export async function sendPushToChannel(opts: {
  dmChannelId: string
  senderName: string
  senderAvatarUrl?: string | null
  content: string
  mentionedIds?: string[]
  excludeUserId: string
}): Promise<void> {
  try {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn("sendPushToChannel: VAPID keys not configured — push notifications disabled")
    return
  }
  ensureVapid()

  const { dmChannelId, senderName, senderAvatarUrl, content, mentionedIds = [], excludeUserId } = opts
  const mentionedSet = new Set(mentionedIds)
  const supabase = await createServerSupabaseClient()

  const { data: members } = await supabase
    .from("dm_channel_members")
    .select("user_id")
    .eq("dm_channel_id", dmChannelId)
    .neq("user_id", excludeUserId)
  let memberIds: string[] = members?.map((m: { user_id: string }) => m.user_id) ?? []

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

  // Fetch global (DM-scoped) notification settings for these members
  type SettingsRow = { user_id: string; mode: "all" | "mentions" | "muted"; server_id?: string | null; channel_id?: string | null; thread_id?: string | null }
  const { data: settingsData, error: settingsError } = await supabase
    .from("notification_settings")
    .select("user_id, mode, server_id, channel_id, thread_id")
    .in("user_id", memberIds)
    .is("server_id", null)
    .is("channel_id", null)
    .is("thread_id", null)
  if (settingsError) {
    console.error("sendPushToChannel: failed to fetch settings", { action: "batch-settings", scope: "global", recipientCount: memberIds.length, error: settingsError.message })
  }
  const settings = (settingsData ?? []) as SettingsRow[]

  // Fetch global notification type preferences so mention opt-outs are respected
  const { data: globalTypePrefs, error: globalTypePrefsError } = await supabase
    .from("user_notification_preferences")
    .select("user_id, mention_notifications")
    .in("user_id", memberIds)
  if (globalTypePrefsError) {
    console.error("sendPushToChannel: failed to fetch type preferences", { action: "type-prefs", recipientCount: memberIds.length, error: globalTypePrefsError.message })
  }
  interface TypePref { user_id: string; mention_notifications: boolean | null }
  const globalTypePrefMap = new Map<string, TypePref>(
    (globalTypePrefs ?? []).map((p: TypePref) => [p.user_id, p])
  )

  const notificationTitle = senderName
  const notificationBody = content.length > 100 ? content.slice(0, 97) + "…" : content

  // Use sender's avatar for the notification icon; fall back to the app icon
  // for system notifications or when no avatar is available
  const notificationIcon = senderAvatarUrl || "/icon-192.png"

  const payload: PushPayload = {
    title: notificationTitle,
    body: notificationBody,
    url: `/channels/me/${dmChannelId}`,
    tag: dmChannelId,
    icon: notificationIcon,
  }

  await Promise.allSettled(
    memberIds.map((uid) => {
      const eventType = mentionedSet.has(uid) ? "mention" : "message"
      const resolved = resolveNotification(
        uid,
        null,
        null,
        null,
        eventType,
        settings
      )

      if (!resolved.shouldPush) return

      // Respect global mention opt-out even when channel mode allows it
      const typePrefs = globalTypePrefMap.get(uid)
      if (eventType === "mention") {
        if (typePrefs && typePrefs.mention_notifications === false) return
      }

      return sendPushToUser(uid, payload, { skipQuietHours: true })
    })
  )
  } catch (err) {
    console.error("sendPushToChannel: unexpected error", err)
  }
}
