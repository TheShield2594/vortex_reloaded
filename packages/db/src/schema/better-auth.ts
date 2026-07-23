import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { uuidPk } from "./columns"
import { users } from "./users"

/**
 * Better Auth writes real JS `Date` objects for every field it considers
 * "date"-typed (createdAt/updatedAt/expiresAt/lockedUntil/...) — unlike the
 * rest of this schema's own `createdAt()`/`updatedAt()` helpers (schema/columns.ts),
 * which produce plain ISO-8601 *strings* for the app's own writes. Passing a
 * Date straight into a plain `text()` column crashes better-sqlite3 ("can
 * only bind numbers, strings, bigints, buffers, and null") — SQLite has no
 * text-mode timestamp support in Drizzle, only `integer({mode: "timestamp"})`
 * (Unix epoch seconds), so every date column Better Auth itself writes to
 * uses that instead. Safe here specifically because these are brand-new
 * tables with no pre-existing (ISO-string-formatted) data to stay
 * compatible with — contrast with `users.createdAt`/`updatedAt`, which
 * *does* carry migrated data and stays TEXT, with a `databaseHooks.user`
 * hook in apps/web/lib/auth/better-auth.ts converting Better Auth's Date
 * objects to ISO strings before they reach the adapter instead.
 */
function betterAuthTimestamp(name: string) {
  return integer(name, { mode: "timestamp" })
}

/**
 * Tables owned by Better Auth itself (core + the `jwt`, `twoFactor`, and
 * `@better-auth/passkey` plugins registered in
 * apps/web/lib/auth/better-auth.ts), authored by hand against Better Auth
 * 1.6.24's documented schema (see docs/better-auth-verification-spike.md and
 * each plugin's own type definitions) rather than the CLI-generated output,
 * because the `user` model here is mapped onto the existing `users` table
 * (see schema/users.ts) instead of a second identity table — a shape the CLI
 * generator doesn't produce on its own.
 *
 * These supersede five of the hand-rolled tables in schema/auth.ts that
 * were layered on top of Supabase Auth pre-cutover:
 *   - `auth_challenges`      -> the `@better-auth/passkey` plugin manages its
 *     own WebAuthn challenge storage internally; not ported to any table here.
 *   - `auth_sessions`        -> `sessions` (below)
 *   - `auth_trusted_devices` -> the `twoFactor` plugin's own trusted-device
 *     cookie (stateless, no table)
 *   - `passkey_credentials`  -> `passkeys` (below) — the old table's
 *     `verifyWithAdapter()` was a stub/dev-only WebAuthn "verifier"; the
 *     passkey plugin does real verification via @simplewebauthn/server.
 *   - `recovery_codes`       -> `two_factor.backupCodes` (below)
 * `auth_security_policies`, `login_risk_events`, and `login_attempts` have
 * no Better Auth equivalent (passkey-first policy, risk scoring) and remain
 * in schema/auth.ts, wired into the Better Auth config via hooks.
 */

/** Better Auth's `session` model. */
export const sessions = sqliteTable("sessions", {
  id: uuidPk(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: betterAuthTimestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: betterAuthTimestamp("created_at").notNull(),
  updatedAt: betterAuthTimestamp("updated_at").notNull(),
})

/**
 * Better Auth's `account` model — one row per credential (email+password,
 * `providerId: "credential"`) or linked OAuth identity (GitHub/Twitch/
 * Reddit). The data-migration `auth-secrets-export.ts` output
 * (`.migration-output/auth-secrets/{credentials,oauth-identities}.ndjson`)
 * is imported into this table — see packages/db/src/migration/import-auth-secrets.ts.
 */
export const accounts = sqliteTable("accounts", {
  id: uuidPk(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: betterAuthTimestamp("access_token_expires_at"),
  refreshTokenExpiresAt: betterAuthTimestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  /** Only populated on the `providerId: "credential"` row — bcrypt hash, see `password.hash`/`verify` in lib/auth/better-auth.ts. */
  password: text("password"),
  createdAt: betterAuthTimestamp("created_at").notNull(),
  updatedAt: betterAuthTimestamp("updated_at").notNull(),
})

/** Better Auth's `verification` model — email-verification and password-reset tokens. */
export const verifications = sqliteTable("verifications", {
  id: uuidPk(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: betterAuthTimestamp("expires_at").notNull(),
  createdAt: betterAuthTimestamp("created_at").notNull(),
  updatedAt: betterAuthTimestamp("updated_at").notNull(),
})

/**
 * The core `twoFactor` plugin's table — TOTP secret + backup codes.
 * `secret`/`backupCodes` are opaque strings the plugin manages itself
 * (backup codes are stored as a single encoded blob, not one row per code —
 * unlike the old `recovery_codes` table it replaces).
 */
export const twoFactors = sqliteTable("two_factors", {
  id: uuidPk(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: betterAuthTimestamp("locked_until"),
})

/** The `@better-auth/passkey` plugin's table — real WebAuthn credential storage. */
export const passkeys = sqliteTable("passkeys", {
  id: uuidPk(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull().unique(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
  transports: text("transports"),
  createdAt: betterAuthTimestamp("created_at"),
  aaguid: text("aaguid"),
})

/**
 * The `jwt` plugin's signing-key store — the asymmetric keypair `apps/signal`
 * verifies handshake JWTs against via the public `/api/auth/jwks` endpoint
 * (see docs/better-auth-verification-spike.md §3). `privateKey` is encrypted
 * at rest by the plugin (AES-256-GCM, per `disablePrivateKeyEncryption:
 * false` default) using `secret`/`secrets` from the Better Auth config.
 */
export const jwks = sqliteTable("jwks", {
  id: uuidPk(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: betterAuthTimestamp("created_at").notNull(),
  expiresAt: betterAuthTimestamp("expires_at"),
})
