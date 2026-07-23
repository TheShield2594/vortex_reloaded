import { closeSync, mkdirSync, openSync, writeSync } from "node:fs"
import path from "node:path"
import type { Pool } from "pg"
import { resolveMigrationOutputDir } from "./output-dir"

/**
 * Handles the three "auth data needs extra care" checklist items from issue
 * #7. These three sources live in Supabase's private `auth` schema —
 * `auth.users`, `auth.mfa_factors`, `auth.identities` — which is *not* part
 * of the 28-table target schema from issue #6 (see schema/auth.ts's module
 * comment: the hand-rolled `auth_*` app tables it defines are layered on
 * top of Supabase Auth, not a port of Supabase's own auth schema). Better
 * Auth's own `user`/`account`/`twoFactor` tables don't exist in this repo
 * yet — generating them is issue #8's job (its CLI-generate step, per
 * docs/better-auth-verification-spike.md) — so this script can't import
 * these into a Drizzle table that doesn't exist.
 *
 * Instead, this exports a best-effort-mapped staging file for #8 to consume
 * once that schema lands, kept entirely separate from the normal
 * export.ts/import.ts NDJSON dumps:
 *
 *   - Passwords: `auth.users.encrypted_password` (a standard bcrypt hash)
 *     copied as-is. Per issue #7: verified with `bcrypt.compare()` in the
 *     new Credentials `authorize()` callback, NOT re-hashed into Better
 *     Auth's own (scrypt-based) password format — no forced reset.
 *   - TOTP secrets: `auth.mfa_factors` (factor_type = 'totp'), mapped
 *     toward Better Auth's `twoFactor` table shape (userId, secret).
 *     Backup codes are unaffected by this — those already live in the
 *     app's own `recovery_codes` table (schema/auth.ts), which is a normal
 *     public-schema table migrated by export.ts/import.ts like everything
 *     else, not part of this file.
 *   - OAuth links: `auth.identities`, explicitly best-effort field-mapped
 *     (the decision issue #7 asks for, rather than "accept that linked-OAuth
 *     users re-link") toward Better Auth's `account` table shape — userId,
 *     provider, providerAccountId, email. Supabase's `auth.identities`
 *     doesn't expose OAuth access/refresh tokens through this table, so
 *     those are NOT carried over; only the identity link itself is, which
 *     is enough for #8 to pre-populate `account` rows so a returning user's
 *     next OAuth sign-in matches an existing linked identity instead of
 *     creating a duplicate account.
 *
 * Never logs secret values — only row counts. Output files are written
 * 0600 (owner read/write only) and MUST NOT be committed (see .gitignore;
 * this writes under the same gitignored migration-output directory as
 * export.ts's NDJSON dumps).
 */

function writeSecretFile(filePath: string, lines: string[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const fd = openSync(filePath, "w", 0o600)
  try {
    for (const line of lines) writeSync(fd, line + "\n")
  } finally {
    closeSync(fd)
  }
}

export interface AuthSecretsCounts {
  credentials: number
  totpFactors: number
  oauthIdentities: number
}

export async function exportAuthSecrets(pool: Pool, outputDir: string = resolveMigrationOutputDir()): Promise<AuthSecretsCounts> {
  const dir = path.join(outputDir, "auth-secrets")

  const { rows: users } = await pool.query(
    `SELECT id, email, encrypted_password, email_confirmed_at IS NOT NULL AS email_verified
     FROM auth.users
     WHERE encrypted_password IS NOT NULL
     ORDER BY id`
  )
  writeSecretFile(
    path.join(dir, "credentials.ndjson"),
    users.map((u) =>
      JSON.stringify({
        userId: u.id,
        email: u.email,
        emailVerified: u.email_verified,
        // bcrypt — verify with bcrypt.compare() in the Credentials
        // authorize() callback, not Better Auth's native password verifier.
        passwordHash: u.encrypted_password,
        passwordHashAlgorithm: "bcrypt",
      })
    )
  )

  const { rows: factors } = await pool.query(
    `SELECT id, user_id, secret, status
     FROM auth.mfa_factors
     WHERE factor_type = 'totp'
     ORDER BY id`
  )
  writeSecretFile(
    path.join(dir, "totp-factors.ndjson"),
    factors.map((f) =>
      JSON.stringify({
        userId: f.user_id,
        secret: f.secret,
        verified: f.status === "verified",
      })
    )
  )

  const { rows: identities } = await pool.query(
    `SELECT id, user_id, provider, identity_data
     FROM auth.identities
     WHERE provider IN ('github', 'twitch', 'reddit')
     ORDER BY id`
  )
  writeSecretFile(
    path.join(dir, "oauth-identities.ndjson"),
    identities.map((i) =>
      JSON.stringify({
        userId: i.user_id,
        provider: i.provider,
        providerAccountId: i.identity_data?.sub ?? i.identity_data?.provider_id ?? null,
        email: i.identity_data?.email ?? null,
      })
    )
  )

  console.log(`  auth-secrets: ${users.length} credential(s), ${factors.length} TOTP factor(s), ${identities.length} OAuth identity(ies)`)
  console.log(`  written to ${dir} (mode 0600, gitignored — never commit this)`)

  return { credentials: users.length, totpFactors: factors.length, oauthIdentities: identities.length }
}

async function main() {
  const { createPgPool } = await import("./pg-client")
  const pool = createPgPool()
  try {
    await exportAuthSecrets(pool)
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
