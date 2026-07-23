import Database from "better-sqlite3"
import { resolveDbPath } from "./db-path"
import { applyFts5AndTriggers, applyTableMigrations } from "./schema-setup"

/**
 * Two-step migration, run in order:
 *   1. drizzle-kit's generated table DDL (src/../migrations, via drizzle-orm's migrator)
 *   2. the hand-written FTS5 virtual table + triggers (src/sql/fts5-and-triggers.sql),
 *      which reference tables step 1 must have already created.
 *
 * Idempotent: the generated migrations are tracked by drizzle's own
 * migrations table, and every statement in fts5-and-triggers.sql uses
 * `IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS`.
 *
 * For migrating existing Supabase data into a fresh SQLite file, use
 * `src/migration/run.ts` instead — it applies these same two steps with a
 * bulk data import in between (see that file's module comment).
 */
function main() {
  const dbPath = resolveDbPath()
  const sqlite = new Database(dbPath)
  sqlite.pragma("foreign_keys = ON")

  applyTableMigrations(sqlite)
  applyFts5AndTriggers(sqlite)

  sqlite.close()
  console.log(`Migrated ${dbPath}`)
}

if (require.main === module) {
  main()
}
