import { sql } from "drizzle-orm"
import { check, index, integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { createdAt, updatedAt, uuidPk } from "./columns"
import { users } from "./users"

/**
 * supabase/migrations/00011_notifications_emoji_webhooks.sql, 00100_perf_composite_indexes.sql.
 *
 * `server_id`/`channel_id`/`message_id` pointed at now-dropped
 * servers/channels/messages tables — kept as plain (no-FK) columns since
 * `notifications` itself stays live, but nothing will populate them going
 * forward (DM/friend-request/system notifications never used them).
 * Issue #40's `verify_prompt` type is the one exception: it repurposes
 * `channel_id` for the dm_channels id the nudge relates to and `message_id`
 * for the other user's id (the safety-number counterpart to verify with) —
 * see apps/web/app/api/dm/channels/[channelId]/members/route.ts.
 *
 * Postgres had two overlapping unread indexes
 * (`notifications_unread_idx` on `(user_id, read)` and
 * `idx_notifications_user_unread` on `(user_id, created_at desc)`, both
 * `WHERE read = false`) — a leftover of a `CREATE INDEX CONCURRENTLY IF NOT
 * EXISTS` that never superseded the original. Consolidated to the one that
 * also sorts by recency; a freshly authored target schema has no reason to
 * carry the redundant one forward.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["mention", "reply", "friend_request", "server_invite", "system", "verify_prompt"],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    iconUrl: text("icon_url"),
    serverId: text("server_id"),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId, table.createdAt),
    index("idx_notifications_user_unread")
      .on(table.userId, table.createdAt)
      .where(sql`${table.read} = 0`),
    check(
      "notifications_type_check",
      sql`${table.type} in ('mention', 'reply', 'friend_request', 'server_invite', 'system', 'verify_prompt')`
    ),
  ]
)

/**
 * supabase/migrations/00059_user_notification_preferences.sql, 00064_quiet_hours.sql,
 * 00092_notification_enhancements.sql, 00093_notification_volume.sql, 00096_notification_extra_prefs.sql.
 * One row per user — `user_id` is both PK and FK.
 */
export const userNotificationPreferences = sqliteTable(
  "user_notification_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    mentionNotifications: integer("mention_notifications", { mode: "boolean" }).notNull().default(true),
    replyNotifications: integer("reply_notifications", { mode: "boolean" }).notNull().default(true),
    friendRequestNotifications: integer("friend_request_notifications", { mode: "boolean" })
      .notNull()
      .default(true),
    serverInviteNotifications: integer("server_invite_notifications", { mode: "boolean" })
      .notNull()
      .default(true),
    systemNotifications: integer("system_notifications", { mode: "boolean" }).notNull().default(true),
    soundEnabled: integer("sound_enabled", { mode: "boolean" }).notNull().default(true),
    quietHoursEnabled: integer("quiet_hours_enabled", { mode: "boolean" }).notNull().default(false),
    /** "HH:MM" — was Postgres TIME. */
    quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("08:00"),
    quietHoursTimezone: text("quiet_hours_timezone").notNull().default("UTC"),
    suppressEveryone: integer("suppress_everyone", { mode: "boolean" }).notNull().default(false),
    suppressRoleMentions: integer("suppress_role_mentions", { mode: "boolean" }).notNull().default(false),
    notificationVolume: real("notification_volume").notNull().default(0.5),
    pushNotifications: integer("push_notifications", { mode: "boolean" }).notNull().default(true),
    showMessagePreview: integer("show_message_preview", { mode: "boolean" }).notNull().default(true),
    showUnreadBadge: integer("show_unread_badge", { mode: "boolean" }).notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "user_notification_preferences_volume_range",
      sql`${table.notificationVolume} >= 0 and ${table.notificationVolume} <= 1`
    ),
  ]
)

/** supabase/migrations/00009_group_dms.sql. Untouched by any later migration. */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (table) => [unique("push_subscriptions_user_endpoint_unique").on(table.userId, table.endpoint)]
)

/**
 * Self-hosted push via ntfy (issue #38) — an alternative delivery channel to
 * Web Push that doesn't route through Google FCM / Apple APNs. One row per
 * user: a private, unguessable topic name the server publishes to
 * (lib/push/ntfy.ts) and the user subscribes to directly from an ntfy
 * client pointed at their own self-hosted NTFY_SERVER_URL — no third party
 * ever sees that a notification was sent.
 */
export const ntfySubscriptions = sqliteTable(
  "ntfy_subscriptions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique("ntfy_subscriptions_topic_unique").on(table.topic)]
)
