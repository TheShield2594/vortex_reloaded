import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { createdAt, updatedAt, uuidPk } from "./columns"
import { users } from "./users"

/** supabase/migrations/00006_friendships.sql */
export const friendships = sqliteTable(
  "friendships",
  {
    id: uuidPk(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted", "blocked"] })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("friendships_unique").on(table.requesterId, table.addresseeId),
    check("friendships_no_self", sql`${table.requesterId} <> ${table.addresseeId}`),
    check("friendships_status_check", sql`${table.status} in ('pending', 'accepted', 'blocked')`),
    index("friendships_requester_idx").on(table.requesterId),
    index("friendships_addressee_idx").on(table.addresseeId),
  ]
)

/** supabase/migrations/00033_channel_editing.sql (table added despite the filename) */
export const userConnections = sqliteTable(
  "user_connections",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["steam", "github", "x", "twitch", "youtube", "reddit", "website"],
    }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    profileUrl: text("profile_url"),
    metadata: text("metadata", { mode: "json" }).notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("user_connections_user_provider_unique").on(table.userId, table.provider),
    unique("user_connections_provider_user_unique").on(table.provider, table.providerUserId),
    index("user_connections_user_id_idx").on(table.userId),
    check(
      "user_connections_provider_check",
      sql`${table.provider} in ('steam', 'github', 'x', 'twitch', 'youtube', 'reddit', 'website')`
    ),
  ]
)

/**
 * supabase/migrations/00079_user_badges.sql
 * `id` is an app-assigned slug (e.g. "early_adopter"), not a UUID — kept as
 * TEXT to match, no uuidPk() here.
 */
export const badgeDefinitions = sqliteTable(
  "badge_definitions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("award"),
    color: text("color").notNull().default("#00e5ff"),
    category: text("category", {
      enum: ["general", "activity", "moderation", "special", "server"],
    })
      .notNull()
      .default("general"),
    rarity: text("rarity", { enum: ["common", "uncommon", "rare", "legendary"] })
      .notNull()
      .default("common"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "badge_definitions_category_check",
      sql`${table.category} in ('general', 'activity', 'moderation', 'special', 'server')`
    ),
    check(
      "badge_definitions_rarity_check",
      sql`${table.rarity} in ('common', 'uncommon', 'rare', 'legendary')`
    ),
  ]
)

/** supabase/migrations/00079_user_badges.sql */
export const userBadges = sqliteTable(
  "user_badges",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: text("badge_id")
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: "cascade" }),
    awardedAt: createdAt("awarded_at"),
    /** NULL = system-awarded. */
    awardedBy: text("awarded_by").references(() => users.id, { onDelete: "set null" }),
    /** e.g. { server_id } for server-specific badges. */
    metadata: text("metadata", { mode: "json" }),
  },
  (table) => [
    unique("user_badges_user_badge_unique").on(table.userId, table.badgeId),
    index("idx_user_badges_user_id").on(table.userId),
    index("idx_user_badges_badge_id").on(table.badgeId),
  ]
)

/** supabase/migrations/00057_user_pinned_items.sql */
export const userPinnedItems = sqliteTable(
  "user_pinned_items",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pinType: text("pin_type", { enum: ["message", "channel", "file", "link"] }).notNull(),
    label: text("label").notNull(),
    sublabel: text("sublabel"),
    /** Polymorphic reference (message/file/channel id); no FK. Null for raw links. */
    refId: text("ref_id"),
    url: text("url"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_user_pinned_items_user_position").on(table.userId, table.position),
    check(
      "user_pinned_items_pin_type_check",
      sql`${table.pinType} in ('message', 'channel', 'file', 'link')`
    ),
    check("user_pinned_items_label_length", sql`length(${table.label}) between 1 and 120`),
    check(
      "user_pinned_items_sublabel_length",
      sql`${table.sublabel} is null or length(${table.sublabel}) <= 80`
    ),
    check("user_pinned_items_url_length", sql`${table.url} is null or length(${table.url}) <= 2000`),
  ]
)

/**
 * supabase/migrations/00058_user_activity_log.sql, 00070_verify_migration_fixes.sql.
 * The Postgres `trg_prune_activity_log` (caps each user at their 50 most
 * recent rows) is a plain row-level AFTER INSERT trigger, so it's ported
 * as a real SQLite trigger of the same name — see
 * ../sql/fts5-and-triggers.sql — rather than application code.
 */
export const userActivityLog = sqliteTable(
  "user_activity_log",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: ["message_posted", "file_uploaded", "server_joined", "reaction_added", "channel_created"],
    }).notNull(),
    summary: text("summary").notNull(),
    /** Polymorphic reference (channel/server/message id); no FK. */
    refId: text("ref_id"),
    refType: text("ref_type", { enum: ["channel", "server", "message", "file"] }),
    refLabel: text("ref_label"),
    refUrl: text("ref_url"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_user_activity_log_user_created").on(table.userId, table.createdAt),
    check(
      "user_activity_log_event_type_check",
      sql`${table.eventType} in ('message_posted', 'file_uploaded', 'server_joined', 'reaction_added', 'channel_created')`
    ),
    check(
      "user_activity_log_ref_type_check",
      sql`${table.refType} is null or ${table.refType} in ('channel', 'server', 'message', 'file')`
    ),
    check("user_activity_log_summary_length", sql`length(${table.summary}) between 1 and 200`),
    check(
      "user_activity_log_ref_label_length",
      sql`${table.refLabel} is null or length(${table.refLabel}) <= 80`
    ),
    check("user_activity_log_ref_url_length", sql`${table.refUrl} is null or length(${table.refUrl}) <= 500`),
  ]
)
