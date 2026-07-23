import { readFileSync } from "node:fs"
import path from "node:path"
import type Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

/**
 * Step 1 of DB setup: drizzle-kit's generated table DDL — no triggers, no
 * FTS5 virtual table yet. Split out from applyFts5AndTriggers() (below) so
 * migration/import.ts can bulk-load table data in between the two steps,
 * before any of fts5-and-triggers.sql's triggers exist to fire on every
 * inserted row — see that file's module comment for why that ordering
 * matters. migrate.ts (fresh empty DB) just calls both back to back.
 */
export function applyTableMigrations(sqlite: Database.Database): void {
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: path.join(__dirname, "..", "migrations") })
}

/**
 * Step 2: the hand-written FTS5 virtual table + triggers (see
 * src/sql/fts5-and-triggers.sql) that reference tables step 1 must have
 * already created. Idempotent (every statement uses `IF NOT EXISTS` /
 * `CREATE TRIGGER IF NOT EXISTS`).
 */
export function applyFts5AndTriggers(sqlite: Database.Database): void {
  const rawSql = readFileSync(path.join(__dirname, "sql", "fts5-and-triggers.sql"), "utf-8")
  sqlite.exec(rawSql)
}
