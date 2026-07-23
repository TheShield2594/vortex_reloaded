import { randomUUID } from "node:crypto"
import { customType, text } from "drizzle-orm/sqlite-core"

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
 * Same as createdAt, but also refreshed on every Drizzle-issued UPDATE via
 * `$onUpdateFn`. Unlike the Postgres "set updated_at = now()" BEFORE UPDATE
 * triggers this stands in for, this is enforced by the ORM layer, not the
 * database — a raw SQL UPDATE (another process, a migration script, a
 * different client) bypasses it. No DB-level trigger enforces this today;
 * callers that write outside Drizzle must set `updated_at` themselves.
 */
export function updatedAt(name = "updated_at") {
  return text(name)
    .notNull()
    .$defaultFn(() => new Date().toISOString())
    .$onUpdateFn(() => new Date().toISOString())
}

/**
 * Same on-disk shape as `createdAt()`/`updatedAt()` (ISO-8601 TEXT) but
 * typed as `Date` at the Drizzle level and — critically — accepts a real
 * `Date` object as the value to bind, converting it to an ISO string via
 * `toDriver` before it ever reaches better-sqlite3 (which can only bind
 * numbers/strings/bigints/buffers/null, not Date instances).
 *
 * Needed specifically for `users.createdAt`/`updatedAt` (schema/users.ts):
 * Better Auth's own internal-adapter always constructs `new Date()` for
 * these fields when it creates/updates a user (see
 * node_modules/better-auth/dist/db/internal-adapter.mjs), and — unlike the
 * brand-new Better Auth-owned tables in schema/better-auth.ts, which use
 * plain `integer({mode: "timestamp"})` for the same reason — `users` also
 * carries data from the general Postgres migration
 * (packages/db/src/migration/{export,import}.ts), which writes plain
 * ISO-8601 strings via raw SQL, bypassing Drizzle's column typing entirely.
 * `integer({mode: "timestamp"})` would misinterpret those migrated strings
 * as Unix-epoch integers on read; this type keeps the on-disk format
 * unchanged for both write paths while still accepting Better Auth's Date
 * objects.
 */
export const isoDate = customType<{ data: Date; driverData: string }>({
  dataType() {
    return "text"
  },
  toDriver(value) {
    return value.toISOString()
  },
  fromDriver(value) {
    return new Date(value)
  },
})
