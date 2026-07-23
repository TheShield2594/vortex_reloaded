import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, userNotificationPreferences } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"
import type { UserNotificationPreferences } from "@vortex/shared"

const db = createDb()

const DEFAULTS: UserNotificationPreferences = {
  mention_notifications: true,
  reply_notifications: true,
  friend_request_notifications: true,
  server_invite_notifications: true,
  system_notifications: true,
  sound_enabled: true,
  notification_volume: 0.5,
  suppress_everyone: false,
  suppress_role_mentions: false,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
  quiet_hours_timezone: "UTC",
  push_notifications: true,
  show_message_preview: true,
  show_unread_badge: true,
}

// GET /api/user/notification-preferences
export async function GET() {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const selectColumns = {
      mentionNotifications: userNotificationPreferences.mentionNotifications,
      replyNotifications: userNotificationPreferences.replyNotifications,
      friendRequestNotifications: userNotificationPreferences.friendRequestNotifications,
      serverInviteNotifications: userNotificationPreferences.serverInviteNotifications,
      systemNotifications: userNotificationPreferences.systemNotifications,
      soundEnabled: userNotificationPreferences.soundEnabled,
      notificationVolume: userNotificationPreferences.notificationVolume,
      suppressEveryone: userNotificationPreferences.suppressEveryone,
      suppressRoleMentions: userNotificationPreferences.suppressRoleMentions,
      quietHoursEnabled: userNotificationPreferences.quietHoursEnabled,
      quietHoursStart: userNotificationPreferences.quietHoursStart,
      quietHoursEnd: userNotificationPreferences.quietHoursEnd,
      quietHoursTimezone: userNotificationPreferences.quietHoursTimezone,
      pushNotifications: userNotificationPreferences.pushNotifications,
      showMessagePreview: userNotificationPreferences.showMessagePreview,
      showUnreadBadge: userNotificationPreferences.showUnreadBadge,
    }

    let rows: Array<Record<string, unknown>>
    try {
      rows = await db
        .select(selectColumns)
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, user.id))
        .limit(1)
    } catch (err) {
      console.error("[api/user/notification-preferences][GET] failed to load preferences", {
        userId: user.id,
        action: "load_preferences",
        error: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json({ error: "Failed to load notification preferences" }, { status: 500 })
    }

    const row = rows[0]
    return NextResponse.json(row ? toSnakeCase<UserNotificationPreferences>(row) : DEFAULTS)
  } catch (err) {
    console.error("[api/user/notification-preferences][GET] unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/user/notification-preferences
export async function PUT(req: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rawBody = await req.json().catch(() => null)
    if (rawBody == null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 })
    }
    const body = rawBody as Record<string, unknown>

    // Validate: only accept boolean values for known boolean keys
    const BOOL_KEYS = [
      "mention_notifications",
      "reply_notifications",
      "friend_request_notifications",
      "server_invite_notifications",
      "system_notifications",
      "sound_enabled",
      "suppress_everyone",
      "suppress_role_mentions",
      "quiet_hours_enabled",
      "push_notifications",
      "show_message_preview",
      "show_unread_badge",
    ] as const

    const BOOL_KEY_TO_COLUMN = {
      mention_notifications: "mentionNotifications",
      reply_notifications: "replyNotifications",
      friend_request_notifications: "friendRequestNotifications",
      server_invite_notifications: "serverInviteNotifications",
      system_notifications: "systemNotifications",
      sound_enabled: "soundEnabled",
      suppress_everyone: "suppressEveryone",
      suppress_role_mentions: "suppressRoleMentions",
      quiet_hours_enabled: "quietHoursEnabled",
      push_notifications: "pushNotifications",
      show_message_preview: "showMessagePreview",
      show_unread_badge: "showUnreadBadge",
    } as const

    const patch: Partial<typeof userNotificationPreferences.$inferInsert> = {}
    for (const key of BOOL_KEYS) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 })
        }
        patch[BOOL_KEY_TO_COLUMN[key]] = body[key] as boolean
      }
    }

    // Validate notification_volume (float 0–1)
    if ("notification_volume" in body) {
      const vol = body.notification_volume
      if (typeof vol !== "number" || !Number.isFinite(vol) || vol < 0 || vol > 1) {
        return NextResponse.json({ error: "notification_volume must be a number between 0 and 1" }, { status: 400 })
      }
      patch.notificationVolume = vol
    }

    // Validate quiet hours time fields (HH:MM or HH:MM:SS format)
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
    for (const key of ["quiet_hours_start", "quiet_hours_end"] as const) {
      if (key in body) {
        if (typeof body[key] !== "string" || !TIME_RE.test(body[key] as string)) {
          return NextResponse.json({ error: `${key} must be HH:MM or HH:MM:SS format` }, { status: 400 })
        }
        if (key === "quiet_hours_start") patch.quietHoursStart = body[key] as string
        else patch.quietHoursEnd = body[key] as string
      }
    }

    // Validate timezone using Intl API
    if ("quiet_hours_timezone" in body) {
      const tz = body.quiet_hours_timezone
      if (typeof tz !== "string" || !tz || tz.length > 64) {
        return NextResponse.json({ error: "quiet_hours_timezone must be a valid IANA timezone string" }, { status: 400 })
      }
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz })
      } catch {
        return NextResponse.json({ error: "quiet_hours_timezone must be a valid IANA timezone string" }, { status: 400 })
      }
      patch.quietHoursTimezone = tz
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields provided" }, { status: 400 })
    }

    try {
      await db
        .insert(userNotificationPreferences)
        .values({ userId: user.id, ...patch })
        .onConflictDoUpdate({
          target: userNotificationPreferences.userId,
          // $onUpdateFn only fires for a plain .update() call, not the SET clause of an
          // INSERT ... ON CONFLICT DO UPDATE — set it explicitly so it actually refreshes.
          set: { ...patch, updatedAt: new Date().toISOString() },
        })
    } catch (err) {
      console.error("[api/user/notification-preferences][PUT] failed to save preferences", {
        userId: user.id,
        action: "save_preferences",
        error: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json({ error: "Failed to save notification preferences" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[api/user/notification-preferences][PUT] unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
