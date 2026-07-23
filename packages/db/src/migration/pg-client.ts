import { Pool, types } from "pg"

// node-pg returns BIGINT (OID 20) columns as strings by default, to avoid
// silent precision loss for values beyond Number.MAX_SAFE_INTEGER. The only
// bigint columns in the 28-table migration scope are passkey_credentials.counter
// (a WebAuthn signature counter) and dm_attachments.size/attachments.size
// (byte sizes) — none of which get remotely close to that ceiling in
// practice, and the target SQLite schema declares all three as plain
// Drizzle `integer()` columns. Parsing to a JS number here means transform.ts
// doesn't need a per-column override list for this one case.
types.setTypeParser(20, (value) => parseInt(value, 10))

/**
 * `SUPABASE_DB_URL` is the direct Postgres connection string (distinct from
 * `DATABASE_URL`, which per db-path.ts already means "the SQLite target
 * file"). Get this from the Supabase project's Database settings ->
 * Connection string -> URI (the direct connection, not the pooler, for a
 * one-time bulk export).
 */
export function createPgPool(): Pool {
  const connectionString = process.env.SUPABASE_DB_URL?.trim()
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is required (the source Supabase Postgres connection string)")
  }

  return new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: true },
  })
}
