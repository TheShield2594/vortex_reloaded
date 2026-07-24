import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { isoDate, uuidPk } from "./columns"

/**
 * The app's root identity table. Postgres source:
 * supabase/migrations/00001_initial_schema.sql, 00026_user_appearance_settings.sql,
 * 00028_increase_custom_css_limit.sql, 00031_user_custom_status_fields.sql,
 * 00032_users_discovery_policy.sql, 00056_profile_interests.sql,
 * 00063_onboarding_flag.sql, 00083_presence_heartbeat.sql,
 * 00092_notification_enhancements.sql, 00094_giveaway_message_id_and_game_activity.sql.
 *
 * `id` no longer FKs to Supabase's `auth.users` — Supabase Auth is being
 * replaced (see issue #8), so this table is the identity root on its own.
 *
 * `email`/`emailVerified`/`twoFactorEnabled` were added for the Better Auth
 * cutover (issue #8) — Better Auth's `user` model is mapped onto this table
 * (see apps/web/lib/auth/better-auth.ts's `user.fields`) rather than creating
 * a second, competing identity table. `email` was previously only known to
 * Supabase's private `auth.users`, which the general table migration
 * (packages/db/src/migration/{export,import}.ts, `public.*` tables only)
 * can't see — `email` is nullable here specifically so that pass can insert
 * a `users` row before `email` is known, backfilled immediately afterward by
 * packages/db/src/migration/import-auth-secrets.ts from the dedicated
 * `auth.users` export (auth-secrets-export.ts). A row with a null `email`
 * simply has no working credential/OAuth sign-in yet.
 *
 * `interests`' Postgres CHECK also validated each tag against
 * `^[a-z0-9][a-z0-9-]*[a-z0-9]?$` via a helper SQL function — SQLite has no
 * regex support in CHECK, so only the cardinality cap is enforced at the DB
 * level here; tag-format validation moves to the application layer.
 */
export const users = sqliteTable(
  "users",
  {
    id: uuidPk(),
    email: text("email").unique(),
    // Not `.notNull()`, despite Better Auth always writing an explicit
    // true/false itself: the general table migration (see the `email`
    // field's comment above) inserts NULL for every column missing from its
    // Postgres source row, `public.users` included — a `NOT NULL` column
    // would make that raw INSERT fail outright. import-auth-secrets.ts
    // coalesces any remaining NULLs to `false` once it's done backfilling.
    emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
    twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
    username: text("username").notNull().unique(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bannerColor: text("banner_color").default("#5865F2"),
    bannerUrl: text("banner_url"),
    bio: text("bio"),
    customTag: text("custom_tag"),
    status: text("status", {
      enum: ["online", "idle", "dnd", "invisible", "offline"],
    })
      .notNull()
      .default("offline"),
    statusMessage: text("status_message"),
    statusEmoji: text("status_emoji"),
    statusExpiresAt: text("status_expires_at"),
    discoverable: integer("discoverable", { mode: "boolean" }).notNull().default(false),
    /** Whole-value JSON, per the migration plan's JSONB mapping. Shape: { customCss?, ... }. */
    appearanceSettings: text("appearance_settings", { mode: "json" })
      .notNull()
      .default(sql`'{}'`),
    /** JSON-array-serialized TEXT, per the migration plan's TEXT[] mapping. */
    interests: text("interests", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    activityVisibility: text("activity_visibility", {
      enum: ["public", "friends", "private"],
    })
      .notNull()
      .default("public"),
    onboardingCompletedAt: text("onboarding_completed_at"),
    lastOnlineAt: text("last_online_at"),
    /** Whole-value JSON: { game_name, game_id, started_at, source: "steam" | "manual" } | null. */
    gameActivity: text("game_activity", { mode: "json" }),
    // `isoDate`, not the shared `createdAt()`/`updatedAt()` helpers — see
    // that type's doc comment (schema/columns.ts) for why this table needs
    // Date-object-accepting columns specifically.
    createdAt: isoDate("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: isoDate("updated_at")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("idx_users_last_online_at")
      .on(table.lastOnlineAt)
      .where(sql`${table.lastOnlineAt} is not null`),
    check(
      "users_appearance_settings_custom_css_length_check",
      sql`length(coalesce(json_extract(${table.appearanceSettings}, '$.customCss'), '')) <= 50000`
    ),
    check("users_status_emoji_length_check", sql`length(${table.statusEmoji}) <= 8`),
    check(
      "users_interests_max_count",
      sql`json_type(${table.interests}) = 'array' and json_array_length(${table.interests}) <= 15`
    ),
    check(
      "users_status_check",
      sql`${table.status} in ('online', 'idle', 'dnd', 'invisible', 'offline')`
    ),
    check(
      "users_activity_visibility_check",
      sql`${table.activityVisibility} in ('public', 'friends', 'private')`
    ),
  ]
)
