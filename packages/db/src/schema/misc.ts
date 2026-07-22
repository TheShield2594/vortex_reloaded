import { sql } from "drizzle-orm"
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createdAt, updatedAt, uuidPk } from "./columns"
import { users } from "./users"

/**
 * supabase/migrations/00036_reports.sql. `reported_message_id`/`server_id`
 * pointed at now-dropped messages/servers tables — kept as plain (no-FK)
 * columns; per issue #16 this route has no live entry point today, so
 * `server_id` in particular stays permanently null going forward rather
 * than being dropped outright (a deliberate "leave dormant" call, not an
 * oversight).
 */
export const reports = sqliteTable(
  "reports",
  {
    id: uuidPk(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: text("reported_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedMessageId: text("reported_message_id"),
    serverId: text("server_id"),
    reason: text("reason", {
      enum: ["spam", "harassment", "inappropriate_content", "other"],
    }).notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["pending", "reviewed", "resolved", "dismissed"],
    })
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("reports_server_status_idx").on(table.serverId, table.status, table.createdAt),
    index("reports_reporter_idx").on(table.reporterId, table.createdAt),
    index("reports_reported_user_idx").on(table.reportedUserId, table.createdAt),
    check(
      "reports_reason_check",
      sql`${table.reason} in ('spam', 'harassment', 'inappropriate_content', 'other')`
    ),
    check(
      "reports_status_check",
      sql`${table.status} in ('pending', 'reviewed', 'resolved', 'dismissed')`
    ),
    check(
      "reports_description_length",
      sql`${table.description} is null or length(${table.description}) <= 1000`
    ),
  ]
)

/**
 * supabase/migrations/00001_initial_schema.sql, 00081_attachment_decay.sql,
 * 00090_attachment_image_variants.sql. Cron-purge-only per the migration
 * plan — nothing populates new rows anymore, this table just needs to keep
 * existing/legacy rows readable until the decay cron purges them.
 * `message_id` pointed at the now-dropped `messages` table — kept as a
 * plain (no-FK) column for the same reason.
 */
export const attachments = sqliteTable(
  "attachments",
  {
    id: uuidPk(),
    messageId: text("message_id").notNull(),
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
    expiresAt: text("expires_at"),
    lastAccessedAt: text("last_accessed_at"),
    purgedAt: text("purged_at"),
    lifetimeDays: integer("lifetime_days"),
    decayCost: real("decay_cost"),
    blurHash: text("blur_hash"),
    /** Whole-value JSON: { thumbnail: {path,width,height}, standard: {path,width,height} } | null. */
    variants: text("variants", { mode: "json" }),
    processingState: text("processing_state", {
      enum: ["pending", "processing", "completed", "failed"],
    }),
  },
  (table) => [
    index("idx_attachments_message_id").on(table.messageId),
    index("idx_attachments_decay_expiry")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null and ${table.purgedAt} is null`),
    index("idx_attachments_processing_pending")
      .on(table.processingState)
      .where(sql`${table.processingState} = 'pending'`),
    check(
      "attachments_processing_state_check",
      sql`${table.processingState} is null or ${table.processingState} in ('pending', 'processing', 'completed', 'failed')`
    ),
  ]
)
