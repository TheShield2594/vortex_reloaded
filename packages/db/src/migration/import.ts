import { createReadStream, existsSync, rmSync } from "node:fs"
import { createInterface } from "node:readline"
import Database from "better-sqlite3"
import { MIGRATION_TABLES } from "./tables"
import { toSqliteBindValues, type PortableRow } from "./transform"
import { resolveMigrationOutputDir, tableDumpPath } from "./output-dir"
import { applyFts5AndTriggers, applyTableMigrations } from "../schema-setup"

/**
 * Step 3 (+ step 4) of the migration procedure (issue #7): import the
 * NDJSON dumps written by export.ts into a fresh SQLite file, in the
 * FK-dependency order from tables.ts, then rebuild the FTS5 index.
 *
 * Requires an empty/nonexistent target file — this is a one-time bulk load
 * into a brand-new database, not an incremental sync into a live one (see
 * the runbook doc's "dry-run against a copy first" guidance).
 *
 * Ordering trick that avoids a whole class of bugs: this applies only
 * schema-setup.ts's `applyTableMigrations` (plain table DDL, no triggers)
 * before the bulk load, and `applyFts5AndTriggers` (the FTS5 virtual table
 * + every hand-written trigger in src/sql/fts5-and-triggers.sql —
 * dm_message_bump_trigger, dm_rotate_on_member_*, trg_prune_activity_log,
 * trg_dm_reply_same_channel_*) only
 * *after* every row is already loaded. `CREATE TRIGGER` never fires
 * retroactively for existing rows, so none of those triggers' side effects
 * (bumping dm_channels.updated_at/encryption_key_version on every imported
 * dm_channel_members/direct_messages row, pruning "excess" activity-log
 * rows that Postgres already capped, etc.) corrupt the transformed data
 * during the load — they simply apply to future writes, same as they would
 * on a freshly-migrated app. This also makes the FTS5 index rebuild in
 * rebuildFts5Index() below a real one-time backfill rather than redundant
 * with per-row trigger inserts.
 *
 * This bypasses Drizzle's query builder entirely in favor of raw prepared
 * INSERTs — see transform.ts's module comment for why (Drizzle's `.values()`
 * expects camelCase JS field names, not the raw snake_case column names
 * `SELECT *` gives us; going raw also avoids materializing 28 tables' worth
 * of typed insert shapes just for a one-time script).
 */

export interface ImportResult {
  counts: Record<string, number>
}

/**
 * export.ts always writes a dump file per table, even an empty one for a
 * table with zero rows (see exportTable's `writeFileSync(dumpPath, "")`) —
 * so a *missing* file means the export never ran for this table (a botched
 * or partial prior export.ts run), not "this table is empty." Importing
 * silently as zero rows here would report a clean-looking migration that's
 * quietly missing an entire table.
 */
async function readRows(dumpPath: string): Promise<PortableRow[]> {
  if (!existsSync(dumpPath)) {
    throw new Error(`Missing export dump: ${dumpPath} — run export.ts (or run.ts) before import.ts`)
  }

  const rows: PortableRow[] = []
  const rl = createInterface({ input: createReadStream(dumpPath, "utf-8"), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.trim() === "") continue
    rows.push(JSON.parse(line))
  }
  return rows
}

function importTable(sqlite: Database.Database, table: string, rows: PortableRow[]): number {
  if (rows.length === 0) return 0

  const tableInfo = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
  const columns = tableInfo.map((c) => c.name)

  const firstRowKeys = new Set(Object.keys(rows[0]))
  const missing = columns.filter((c) => !firstRowKeys.has(c))
  if (missing.length > 0) {
    console.warn(`  ${table}: source rows are missing column(s) ${missing.join(", ")} — will insert NULL`)
  }

  const placeholders = columns.map(() => "?").join(", ")
  const columnList = columns.map((c) => `"${c}"`).join(", ")
  const stmt = sqlite.prepare(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`)

  const insertAll = sqlite.transaction((batch: PortableRow[]) => {
    for (const row of batch) {
      stmt.run(...toSqliteBindValues(row, columns))
    }
  })
  insertAll(rows)

  return rows.length
}

/**
 * Rebuilds the `direct_messages_fts` index from the already-imported
 * `direct_messages` table (issue #7 step 4's "one-time backfill"), then
 * runs FTS5's built-in integrity check (see
 * docs/sqlite-migration-fts5-transactions-spike.md — the `rank = 1` form,
 * not the bare form, is the one that actually diffs the index against the
 * content table).
 */
export function rebuildFts5Index(sqlite: Database.Database): void {
  sqlite.exec(`INSERT INTO direct_messages_fts(rowid, content) SELECT rowid, content FROM direct_messages;`)
  sqlite.prepare(`INSERT INTO direct_messages_fts(direct_messages_fts, rank) VALUES ('integrity-check', 1)`).run()
}

export async function importAllTables(
  targetPath: string,
  outputDir: string = resolveMigrationOutputDir()
): Promise<ImportResult> {
  if (existsSync(targetPath)) {
    throw new Error(
      `Import target ${targetPath} already exists. import.ts only loads into a fresh/nonexistent SQLite ` +
        `file — see the runbook doc. Delete it first if this is an intentional re-run against a scratch copy.`
    )
  }

  const sqlite = new Database(targetPath)
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("busy_timeout = 5000")
  sqlite.pragma("journal_mode = WAL")

  const counts: Record<string, number> = {}
  let succeeded = false
  try {
    applyTableMigrations(sqlite)

    for (const table of MIGRATION_TABLES) {
      const rows = await readRows(tableDumpPath(outputDir, table.name))
      const count = importTable(sqlite, table.name, rows)
      counts[table.name] = count
      console.log(`  imported ${table.name}: ${count} rows`)
    }

    applyFts5AndTriggers(sqlite)
    rebuildFts5Index(sqlite)
    console.log("  rebuilt direct_messages_fts index and passed integrity check")
    succeeded = true
  } finally {
    sqlite.close()
    if (!succeeded) {
      // Don't leave a half-loaded database behind on failure — it would
      // otherwise sit there looking like a real file and block a retry via
      // the "already exists" guard above. Best-effort: failing to clean up
      // must never hide the real error from the migration/parsing/FTS
      // failure that got us here.
      for (const file of [targetPath, `${targetPath}-wal`, `${targetPath}-shm`]) {
        try {
          rmSync(file, { force: true })
        } catch {
          // ignore — the original error is what matters
        }
      }
    }
  }

  return { counts }
}

async function main() {
  const { resolveDbPath } = await import("../db-path")
  const targetPath = process.argv[2] ?? resolveDbPath()
  const outputDir = resolveMigrationOutputDir()
  console.log(`Importing ${MIGRATION_TABLES.length} tables from ${outputDir} into ${targetPath}`)
  const { counts } = await importAllTables(targetPath, outputDir)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`Done: ${total} rows across ${MIGRATION_TABLES.length} tables`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
