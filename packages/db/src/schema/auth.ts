import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createdAt, updatedAt, uuidPk } from "./columns"
import { users } from "./users"

/**
 * All 8 tables below: supabase/migrations/00019_passkeys_and_sessions.sql
 * unless noted otherwise. These are hand-rolled MFA/passkey/session-risk
 * app tables layered on top of Supabase Auth today — not Supabase's own
 * `auth.users`/`auth.identities` schema, which is out of scope entirely
 * (Supabase Auth itself is being replaced, see issue #8).
 */
export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    id: uuidPk(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    flow: text("flow", { enum: ["register", "login"] }).notNull(),
    challenge: text("challenge").notNull(),
    rpId: text("rp_id").notNull(),
    origin: text("origin").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_auth_challenges_user_flow").on(table.userId, table.flow),
    check("auth_challenges_flow_check", sql`${table.flow} in ('register', 'login')`),
  ]
)

export const authTrustedDevices = sqliteTable(
  "auth_trusted_devices",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    lastSeenAt: createdAt("last_seen_at"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (table) => [index("idx_auth_trusted_devices_user_id").on(table.userId)]
)

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trustedDeviceId: text("trusted_device_id").references(() => authTrustedDevices.id, {
      onDelete: "set null",
    }),
    sessionTokenHash: text("session_token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
    lastSeenAt: createdAt("last_seen_at"),
  },
  (table) => [index("idx_auth_sessions_user_id").on(table.userId)]
)

/** One row per user — `user_id` is both PK and FK. */
export const authSecurityPolicies = sqliteTable(
  "auth_security_policies",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    passkeyFirst: integer("passkey_first", { mode: "boolean" }).notNull().default(false),
    enforcePasskey: integer("enforce_passkey", { mode: "boolean" }).notNull().default(false),
    fallbackPassword: integer("fallback_password", { mode: "boolean" }).notNull().default(true),
    fallbackMagicLink: integer("fallback_magic_link", { mode: "boolean" }).notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("auth_security_policies_passkey_first_check", sql`${table.passkeyFirst} in (0, 1)`),
    check("auth_security_policies_enforce_passkey_check", sql`${table.enforcePasskey} in (0, 1)`),
    check("auth_security_policies_fallback_password_check", sql`${table.fallbackPassword} in (0, 1)`),
    check(
      "auth_security_policies_fallback_magic_link_check",
      sql`${table.fallbackMagicLink} in (0, 1)`
    ),
  ]
)

/**
 * `transports` is a Postgres `TEXT[]` — the migration plan's TEXT[] mapping
 * (JSON-array-serialized TEXT) applies here too, not just `users.interests`
 * (the only case the plan calls out by name, but the mapping rule itself is
 * general).
 */
export const passkeyCredentials = sqliteTable(
  "passkey_credentials",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    deviceType: text("device_type").notNull().default("singleDevice"),
    name: text("name").notNull().default("Unnamed device"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_passkey_credentials_user_id").on(table.userId),
    check("passkey_credentials_transports_check", sql`json_type(${table.transports}) = 'array'`),
  ]
)

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: text("used_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_recovery_codes_user_id").on(table.userId),
    index("idx_recovery_codes_user_unused")
      .on(table.userId)
      .where(sql`${table.usedAt} is null`),
  ]
)

/**
 * supabase/migrations/00046_login_risk_events.sql.
 * Postgres FKs this to `auth.users`, not `public.users` (the only one of
 * these 8 tables that did) — unified onto our single `users` table since
 * the auth/public schema split doesn't carry over to SQLite.
 */
export const loginRiskEvents = sqliteTable(
  "login_risk_events",
  {
    id: uuidPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    locationHint: text("location_hint"),
    riskScore: integer("risk_score").notNull().default(0),
    reasons: text("reasons", { mode: "json" }).notNull().default(sql`'[]'`),
    suspicious: integer("suspicious", { mode: "boolean" }).notNull().default(false),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_login_risk_events_user_created").on(table.userId, table.createdAt),
    index("idx_login_risk_events_suspicious").on(table.suspicious, table.createdAt),
  ]
)

/**
 * supabase/migrations/00035_login_attempts.sql, 00041_hardening_policy_fixes.sql (index only).
 * No FK to `users` — attempts are recorded by email before identity is known
 * (e.g. failed logins for a nonexistent account).
 */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    ipAddress: text("ip_address"),
    attemptedAt: createdAt("attempted_at"),
  },
  (table) => [
    index("idx_login_attempts_email").on(table.email),
    index("idx_login_attempts_email_recent").on(table.email, table.attemptedAt),
    index("idx_login_attempts_ip")
      .on(table.ipAddress)
      .where(sql`${table.ipAddress} is not null`),
  ]
)

