import { readFileSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { resolveDbPath } from "./db-path"

/**
 * Two-step migration, run in order:
 *   1. drizzle-kit's generated table DDL (src/../migrations, via drizzle-orm's migrator)
 *   2. the hand-written FTS5 virtual table + triggers (src/sql/fts5-and-triggers.sql),
 *      which reference tables step 1 must have already created.
 *
 * Idempotent: the generated migrations are tracked by drizzle's own
 * migrations table, and every statement in fts5-and-triggers.sql uses
 * `IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS`.
 */
function main() {
  const dbPath = resolveDbPath()
  const sqlite = new Database(dbPath)
  sqlite.pragma("foreign_keys = ON")

  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: path.join(__dirname, "..", "migrations") })

  const rawSql = readFileSync(path.join(__dirname, "sql", "fts5-and-triggers.sql"), "utf-8")
  sqlite.exec(rawSql)

  sqlite.close()
  console.log(`Migrated ${dbPath}`)
}

if (require.main === module) {
  main()
}
