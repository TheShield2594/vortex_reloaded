import { randomUUID } from "node:crypto"
import { text } from "drizzle-orm/sqlite-core"

/**
 * UUID primary key, TEXT-typed, generated client-side by Drizzle
 * (`$defaultFn`, not a DB-level DEFAULT) — matches the migration plan's
 * "UUID -> TEXT, app-generated, no DB default needed" mapping.
 */
export function uuidPk(name = "id") {
  return text(name)
    .primaryKey()
    .$defaultFn(() => randomUUID())
}

/**
 * TIMESTAMPTZ -> ISO-8601 TEXT, generated client-side by Drizzle so the
 * format is a real ISO-8601 string (SQLite's own CURRENT_TIMESTAMP omits
 * the "T"/"Z" and sub-second precision).
 */
export function createdAt(name = "created_at") {
  return text(name)
    .notNull()
    .$defaultFn(() => new Date().toISOString())
}

/**
 * Same as createdAt, but also refreshed on every Drizzle-issued UPDATE —
 * the SQLite equivalent of the Postgres "set updated_at = now()"
 * BEFORE UPDATE triggers used throughout the source schema.
 */
export function updatedAt(name = "updated_at") {
  return text(name)
    .notNull()
    .$defaultFn(() => new Date().toISOString())
    .$onUpdateFn(() => new Date().toISOString())
}
