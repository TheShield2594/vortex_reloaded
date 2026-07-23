import webpush from "web-push"
import { and, eq, inArray, ne } from "drizzle-orm"
import { createDb, dmChannelMembers, pushSubscriptions, userNotificationPreferences } from "@vortex/db"
import { resolveNotification } from "@/lib/notification-resolver"
import { isInQuietHours } from "@/lib/quiet-hours"

const db = createDb()

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

    // Check quiet hours — suppress push if the user is in their scheduled DND window
    if (!skipQuietHours) {
      let quietPrefs: {
        quietHoursEnabled: boolean
        quietHoursStart: string
        quietHoursEnd: string
        quietHoursTimezone: string
      } | undefined

      try {
        const rows = await db
          .select({
            quietHoursEnabled: userNotificationPreferences.quietHoursEnabled,
            quietHoursStart: userNotificationPreferences.quietHoursStart,
            quietHoursEnd: userNotificationPreferences.quietHoursEnd,
            quietHoursTimezone: userNotificationPreferences.quietHoursTimezone,
          })
          .from(userNotificationPreferences)
          .where(eq(userNotificationPreferences.userId, userId))
          .limit(1)
        quietPrefs = rows[0]
      } catch (quietError) {
        console.error("Failed to fetch quiet hours preferences:", quietError instanceof Error ? quietError.message : quietError)
        // Continue sending — fail open rather than suppressing notifications
      }

      if (quietPrefs && isInQuietHours(
        quietPrefs.quietHoursEnabled,
        quietPrefs.quietHoursStart,
        quietPrefs.quietHoursEnd,
        quietPrefs.quietHoursTimezone,
      )) {
        return // suppress during quiet hours
      }
    }

    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))

    if (!subs.length) return

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
            try {
              await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
            } catch (deleteError) {
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
 *
 * NOTE: the old Postgres `notification_settings` table (per server/channel/
 * thread overrides) was dropped along with the servers/channels/threads
 * tables it pointed at — this app is DM-only now and has no Drizzle schema
 * for it (see packages/db/src/schema/notifications.ts). The only rows that
 * could ever apply here were global (all-scope-null) overrides looked up
 * with serverId/channelId/threadId all null; since there is no longer any
 * store for those overrides, this always resolves as "no override found",
 * matching the old fail-open behavior when that query errored.
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

  const members = await db
    .select({ userId: dmChannelMembers.userId })
    .from(dmChannelMembers)
    .where(and(eq(dmChannelMembers.dmChannelId, dmChannelId), ne(dmChannelMembers.userId, excludeUserId)))
  let memberIds: string[] = members.map((m) => m.userId)

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
  let quietHoursPrefs: {
    userId: string
    quietHoursEnabled: boolean
    quietHoursStart: string
    quietHoursEnd: string
    quietHoursTimezone: string
  }[] = []
  try {
    quietHoursPrefs = await db
      .select({
        userId: userNotificationPreferences.userId,
        quietHoursEnabled: userNotificationPreferences.quietHoursEnabled,
        quietHoursStart: userNotificationPreferences.quietHoursStart,
        quietHoursEnd: userNotificationPreferences.quietHoursEnd,
        quietHoursTimezone: userNotificationPreferences.quietHoursTimezone,
      })
      .from(userNotificationPreferences)
      .where(and(
        inArray(userNotificationPreferences.userId, memberIds),
        eq(userNotificationPreferences.quietHoursEnabled, true)
      ))
  } catch (quietHoursError) {
    // Fail open — deliver notifications rather than silently suppressing
    console.error("sendPushToChannel: failed to fetch quiet hours", {
      action: "batch-quiet-hours",
      recipientCount: memberIds.length,
      dmChannelId,
      error: quietHoursError instanceof Error ? quietHoursError.message : quietHoursError,
    })
  }

  if (quietHoursPrefs.length) {
    const quietUserIds = new Set(
      quietHoursPrefs
        .filter((p) => isInQuietHours(p.quietHoursEnabled, p.quietHoursStart, p.quietHoursEnd, p.quietHoursTimezone))
        .map((p) => p.userId)
    )
    if (quietUserIds.size > 0) {
      memberIds = memberIds.filter((uid: string) => !quietUserIds.has(uid))
    }
  }

  if (!memberIds.length) return

  // Per-channel/server/thread notification overrides no longer exist as a
  // data source (see function doc comment above) — always resolve as empty,
  // same as the old fail-open path when that lookup errored.
  type SettingsRow = { user_id: string; mode: "all" | "mentions" | "muted"; server_id?: string | null; channel_id?: string | null; thread_id?: string | null }
  const settings: SettingsRow[] = []

  // Fetch global notification type preferences so mention opt-outs are respected
  let globalTypePrefs: { userId: string; mentionNotifications: boolean }[] = []
  try {
    globalTypePrefs = await db
      .select({
        userId: userNotificationPreferences.userId,
        mentionNotifications: userNotificationPreferences.mentionNotifications,
      })
      .from(userNotificationPreferences)
      .where(inArray(userNotificationPreferences.userId, memberIds))
  } catch (globalTypePrefsError) {
    console.error("sendPushToChannel: failed to fetch type preferences", { action: "type-prefs", recipientCount: memberIds.length, error: globalTypePrefsError instanceof Error ? globalTypePrefsError.message : globalTypePrefsError })
  }
  interface TypePref { user_id: string; mention_notifications: boolean | null }
  const globalTypePrefMap = new Map<string, TypePref>(
    globalTypePrefs.map((p) => [p.userId, { user_id: p.userId, mention_notifications: p.mentionNotifications }])
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
