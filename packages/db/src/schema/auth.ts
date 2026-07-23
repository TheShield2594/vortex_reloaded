import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createdAt, updatedAt, uuidPk } from "./columns"
import { users } from "./users"

/**
 * Hand-rolled MFA/passkey/session-risk app tables, originally all 8 layered
 * on top of Supabase Auth (supabase/migrations/00019_passkeys_and_sessions.sql
 * unless noted otherwise) — not Supabase's own `auth.users`/`auth.identities`
 * schema, which was always out of scope (Supabase Auth itself was replaced,
 * see issue #8).
 *
 * As of the Better Auth cutover (issue #8), 5 of the original 8 were retired
 * in favor of tables/mechanisms Better Auth itself owns (see
 * schema/better-auth.ts and lib/auth/better-auth.ts in apps/web):
 *   - `auth_challenges`      -> the `@better-auth/passkey` plugin manages its
 *     own WebAuthn challenge storage internally; the old table (and the
 *     hand-rolled, dev-only-verified `verifyWithAdapter()` stub it backed)
 *     is gone entirely, not ported.
 *   - `auth_sessions`        -> `sessions`
 *   - `auth_trusted_devices` -> the `twoFactor` plugin's own trusted-device
 *     cookie (`trustDeviceMaxAge`, default 30 days) — stateless, no DB table.
 *   - `passkey_credentials`  -> `passkeys`
 *   - `recovery_codes`       -> `two_factors.backupCodes`
 * The remaining 3 below have no Better Auth equivalent (passkey-first
 * policy, login risk scoring) and stay as app-specific tables wired into
 * the Better Auth config via hooks.
 */

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

/**
 * Issue #3 ("Login"): registration is invite-gated rather than open or
 * phone-number-verified — "server-issued keys + a short invite code or QR,
 * like a mini Matrix." Any authenticated user can generate one (see
 * apps/web/app/api/invites/route.ts); redemption is enforced atomically in
 * `databaseHooks.user.create.before` (lib/auth/better-auth.ts) via a single
 * conditional `use_count + 1` UPDATE, so two simultaneous signups can never
 * both consume the last use of a code.
 */
export const registrationInvites = sqliteTable(
  "registration_invites",
  {
    id: uuidPk(),
    code: text("code").notNull().unique(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_registration_invites_created_by").on(table.createdBy),
    check("registration_invites_max_uses_check", sql`${table.maxUses} >= 1`),
    check("registration_invites_use_count_check", sql`${table.useCount} >= 0`),
  ]
)

