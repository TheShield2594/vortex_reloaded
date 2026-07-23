/**
 * Type conversion mapping from issue #7, applied generically by JS runtime
 * type rather than a per-column config table — every column in every one of
 * the 28 tables (see tables.ts) falls into one of these buckets, and the
 * mapping is the same regardless of which table a value came from:
 *
 *   - UUID            -> passthrough (node-pg already returns uuid columns
 *                        as plain strings, matching the schema's uuidPk()/
 *                        text() columns)
 *   - TIMESTAMPTZ      -> ISO-8601 TEXT (node-pg returns these as JS `Date`)
 *   - JSONB / TEXT[]   -> JSON.stringify() (node-pg already parses jsonb and
 *                        Postgres arrays into JS objects/arrays; SQLite text
 *                        columns need the serialized string back)
 *   - BOOLEAN          -> 0 | 1 (better-sqlite3 can't bind a JS boolean)
 *   - BIGINT           -> number (see pg-types.ts; node-pg returns bigint
 *                        columns as strings by default to avoid precision
 *                        loss, but every bigint column in scope — device-key
 *                        counters, attachment byte sizes — is nowhere near
 *                        Number.MAX_SAFE_INTEGER in practice)
 *   - everything else  -> passthrough (int4/int8-safe integers, real/double,
 *                        plain text)
 */

export type PortableValue = string | number | boolean | null | PortableValue[] | { [key: string]: PortableValue }
export type PortableRow = Record<string, PortableValue>
export type PgRow = Record<string, unknown>

/**
 * Postgres row -> the JSON-serializable shape written to the NDJSON export
 * files. The only real conversion here is Date -> ISO string; everything
 * else is already JSON-safe (and JSON.stringify would coerce Date the same
 * way via Date#toJSON, but doing it explicitly keeps this testable without
 * a stringify/parse round trip).
 */
export function toPortableRow(row: PgRow): PortableRow {
  const out: PortableRow = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : (value as PortableValue)
  }
  return out
}

export type SqliteBindValue = string | number | bigint | Buffer | null

/**
 * Portable row -> the exact values bound to a raw `INSERT INTO "table"
 * (...) VALUES (...)` prepared statement (import.ts bypasses Drizzle's
 * query builder for bulk import — see that file's module comment — so this
 * does the coercion Drizzle's `{ mode: "json" }` / `{ mode: "boolean" }`
 * columns would otherwise do automatically).
 */
export function toSqliteBindValues(row: PortableRow, columns: string[]): SqliteBindValue[] {
  return columns.map((column) => {
    const value = row[column]
    if (value === null || value === undefined) return null
    if (typeof value === "boolean") return value ? 1 : 0
    if (typeof value === "object") return JSON.stringify(value)
    return value
  })
}
