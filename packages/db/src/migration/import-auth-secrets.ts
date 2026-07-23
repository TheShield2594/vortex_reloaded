import { randomUUID } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import Database from "better-sqlite3"
import path from "node:path"
import { resolveMigrationOutputDir } from "./output-dir"

/**
 * Issue #8's counterpart to auth-secrets-export.ts: loads the staging
 * NDJSON files it writes (`.migration-output/auth-secrets/*.ndjson`) into
 * the Better Auth-owned tables (schema/better-auth.ts) of an already
 * `import.ts`-populated SQLite file. Run after import.ts (and, ideally,
 * verify.ts) — see run.ts, which wires this in as the pipeline's final step
 * when `--auth-secrets` is passed.
 *
 * Not idempotent by design, same as import.ts: it inserts unconditionally
 * and expects a freshly-imported target where `accounts`/`two_factors`/
 * `passkeys` are empty. Re-running against a target that already has these
 * rows will violate unique constraints (`accounts` has no natural unique
 * key here, so duplicates silently accumulate instead) — re-run against a
 * fresh import, not a live database.
 */

interface CredentialRow {
  userId: string
  email: string
  emailVerified: boolean
  passwordHash: string
  passwordHashAlgorithm: string
}

interface TotpFactorRow {
  userId: string
  secret: string
  verified: boolean
}

interface OAuthIdentityRow {
  userId: string
  provider: string
  providerAccountId: string | null
  email: string | null
}

interface PasskeyRow {
  userId: string
  credentialID: string
  publicKey: string
  counter: number
  transports: string | null
  backedUp: boolean
  deviceType: string
  name: string | null
}

async function readNdjson<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return []
  const rows: T[] = []
  const rl = createInterface({ input: createReadStream(filePath, "utf-8"), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.trim() === "") continue
    rows.push(JSON.parse(line))
  }
  return rows
}

export interface ImportAuthSecretsResult {
  credentials: number
  totpFactors: number
  oauthIdentities: number
  passkeys: number
}

export async function importAuthSecrets(
  targetPath: string,
  outputDir: string = resolveMigrationOutputDir()
): Promise<ImportAuthSecretsResult> {
  const dir = path.join(outputDir, "auth-secrets")
  const now = new Date().toISOString()

  const [credentials, totpFactors, oauthIdentities, passkeyRows] = await Promise.all([
    readNdjson<CredentialRow>(path.join(dir, "credentials.ndjson")),
    readNdjson<TotpFactorRow>(path.join(dir, "totp-factors.ndjson")),
    readNdjson<OAuthIdentityRow>(path.join(dir, "oauth-identities.ndjson")),
    readNdjson<PasskeyRow>(path.join(dir, "passkeys.ndjson")),
  ])

  const sqlite = new Database(targetPath)
  sqlite.pragma("foreign_keys = ON")

  try {
    const updateUserEmail = sqlite.prepare(
      `UPDATE users SET email = ?, email_verified = ? WHERE id = ?`
    )
    const insertAccount = sqlite.prepare(
      `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const insertTwoFactor = sqlite.prepare(
      `INSERT INTO two_factors (id, user_id, secret, backup_codes, verified)
       VALUES (?, ?, ?, '[]', ?)`
    )
    const enableTwoFactor = sqlite.prepare(`UPDATE users SET two_factor_enabled = 1 WHERE id = ?`)
    const insertPasskey = sqlite.prepare(
      `INSERT INTO passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, transports, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const importCredentials = sqlite.transaction((rows: CredentialRow[]) => {
      for (const row of rows) {
        // bcrypt is the only algorithm this script (or emailAndPassword.password.verify
        // in apps/web/lib/auth/better-auth.ts) knows how to carry over — see
        // auth-secrets-export.ts's module comment.
        if (row.passwordHashAlgorithm !== "bcrypt") continue
        updateUserEmail.run(row.email, row.emailVerified ? 1 : 0, row.userId)
        insertAccount.run(randomUUID(), row.userId, row.userId, "credential", row.passwordHash, now, now)
      }
    })
    importCredentials(credentials)

    const importOAuth = sqlite.transaction((rows: OAuthIdentityRow[]) => {
      for (const row of rows) {
        if (!row.providerAccountId) continue
        insertAccount.run(randomUUID(), row.userId, row.providerAccountId, row.provider, null, now, now)
      }
    })
    importOAuth(oauthIdentities)

    const importTotp = sqlite.transaction((rows: TotpFactorRow[]) => {
      for (const row of rows) {
        insertTwoFactor.run(randomUUID(), row.userId, row.secret, row.verified ? 1 : 0)
        // Matches Better Auth's own rule: `twoFactorEnabled` only flips true
        // once a TOTP factor is verified — an unverified migrated factor
        // shouldn't make the account look 2FA-protected when it isn't.
        if (row.verified) enableTwoFactor.run(row.userId)
      }
    })
    importTotp(totpFactors)

    const importPasskeys = sqlite.transaction((rows: PasskeyRow[]) => {
      for (const row of rows) {
        insertPasskey.run(
          randomUUID(),
          row.name,
          row.publicKey,
          row.userId,
          row.credentialID,
          row.counter,
          row.deviceType,
          row.backedUp ? 1 : 0,
          row.transports,
          now
        )
      }
    })
    importPasskeys(passkeyRows)

    // Every users row `import.ts` created (from the general public.users
    // dump, which has none of these three columns) has NULL here — coalesce
    // whatever the two backfill passes above didn't touch to a real `false`
    // so the app never has to treat NULL as a third boolean state.
    sqlite
      .prepare(
        `UPDATE users SET
           email_verified = coalesce(email_verified, 0),
           two_factor_enabled = coalesce(two_factor_enabled, 0)
         WHERE email_verified IS NULL OR two_factor_enabled IS NULL`
      )
      .run()
  } finally {
    sqlite.close()
  }

  return {
    credentials: credentials.length,
    totpFactors: totpFactors.length,
    oauthIdentities: oauthIdentities.filter((r) => r.providerAccountId).length,
    passkeys: passkeyRows.length,
  }
}

async function main() {
  const { resolveDbPath } = await import("../db-path")
  const targetPath = process.argv[2] ?? resolveDbPath()
  console.log(`Importing auth secrets into ${targetPath}`)
  const result = await importAuthSecrets(targetPath)
  console.log(
    `  imported ${result.credentials} credential(s), ${result.totpFactors} TOTP factor(s), ` +
      `${result.oauthIdentities} OAuth identity(ies), ${result.passkeys} passkey(s)`
  )
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
