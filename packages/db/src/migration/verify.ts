import Database from "better-sqlite3"
import type { Pool } from "pg"
import { MIGRATION_TABLES } from "./tables"
import { toPortableRow, toSqliteBindValues, type PortableRow } from "./transform"

const SAMPLE_SIZE = 25

export interface TableVerification {
  table: string
  postgresCount: number
  sqliteCount: number
  countMatches: boolean
  sampleChecked: number
  sampleMismatches: string[]
}

export interface VerificationReport {
  tables: TableVerification[]
  replyToIntegrityIssues: string[]
  ok: boolean
}

/**
 * Step "diff row counts and a sample of transformed rows before touching
 * production data" from issue #7. Compares the live Postgres source against
 * an already-imported SQLite target:
 *
 *   1. Row counts per table.
 *   2. A sample of rows (first SAMPLE_SIZE by each table's orderBy from
 *      tables.ts), transformed the same way import.ts would, compared
 *      field-by-field against what's actually in SQLite.
 *   3. direct_messages.reply_to_id referential integrity — the
 *      trg_dm_reply_same_channel_* triggers that normally enforce "a
 *      reply's reply_to_id must point at a message in the same DM channel"
 *      don't exist yet during import.ts's bulk-load phase (see that file's
 *      module comment), so this is the check that catches a transform bug
 *      that would otherwise only surface once someone hits "reply" in the
 *      migrated app.
 *
 * Read-only against both databases — safe to run repeatedly, including
 * against production once the import is done.
 */
export async function verifyMigration(pool: Pool, sqlitePath: string): Promise<VerificationReport> {
  const sqlite = new Database(sqlitePath, { readonly: true })
  const tables: TableVerification[] = []

  try {
    for (const table of MIGRATION_TABLES) {
      const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM "public"."${table.name}"`)
      const postgresCount: number = countRows[0].count
      const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table.name}"`).get() as { count: number })
        .count

      const orderBy = table.orderBy.map((c) => `"${c}"`).join(", ")
      const { rows: sampleRows } = await pool.query(
        `SELECT * FROM "public"."${table.name}" ORDER BY ${orderBy} LIMIT $1`,
        [SAMPLE_SIZE]
      )

      const tableInfo = sqlite.prepare(`PRAGMA table_info("${table.name}")`).all() as { name: string }[]
      const columns = tableInfo.map((c) => c.name)
      const whereClause = table.orderBy.map((c) => `"${c}" = ?`).join(" AND ")
      const findStmt = sqlite.prepare(`SELECT * FROM "${table.name}" WHERE ${whereClause}`)

      const sampleMismatches: string[] = []
      for (const pgRow of sampleRows) {
        const portable = toPortableRow(pgRow)
        const expectedBind = toSqliteBindValues(portable, columns)
        const key = table.orderBy.map((c) => portable[c])
        const actual = findStmt.get(...key) as PortableRow | undefined

        if (!actual) {
          sampleMismatches.push(`row ${JSON.stringify(key)}: missing from SQLite`)
          continue
        }

        columns.forEach((col, i) => {
          const actualValue = actual[col] ?? null
          const expectedValue = expectedBind[i]
          if (actualValue !== expectedValue) {
            sampleMismatches.push(`row ${JSON.stringify(key)}, column "${col}": expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`)
          }
        })
      }

      tables.push({
        table: table.name,
        postgresCount,
        sqliteCount,
        countMatches: postgresCount === sqliteCount,
        sampleChecked: sampleRows.length,
        sampleMismatches,
      })
    }

    const replyToIntegrityIssues = (
      sqlite
        .prepare(
          `SELECT id FROM direct_messages AS dm
           WHERE reply_to_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM direct_messages AS parent
               WHERE parent.id = dm.reply_to_id AND parent.dm_channel_id IS dm.dm_channel_id
             )`
        )
        .all() as { id: string }[]
    ).map((r) => `direct_messages.id=${r.id}: reply_to_id does not reference a message in the same dm_channel_id`)

    const ok = tables.every((t) => t.countMatches && t.sampleMismatches.length === 0) && replyToIntegrityIssues.length === 0

    return { tables, replyToIntegrityIssues, ok }
  } finally {
    sqlite.close()
  }
}

function printReport(report: VerificationReport): void {
  for (const t of report.tables) {
    const status = t.countMatches && t.sampleMismatches.length === 0 ? "OK" : "MISMATCH"
    console.log(`  [${status}] ${t.table}: postgres=${t.postgresCount} sqlite=${t.sqliteCount} sample=${t.sampleChecked}`)
    for (const mismatch of t.sampleMismatches.slice(0, 5)) console.log(`      ${mismatch}`)
  }
  if (report.replyToIntegrityIssues.length > 0) {
    console.log(`  [MISMATCH] direct_messages.reply_to_id integrity:`)
    for (const issue of report.replyToIntegrityIssues.slice(0, 5)) console.log(`      ${issue}`)
  }
  console.log(report.ok ? "\nVerification passed." : "\nVerification FAILED — see mismatches above.")
}

async function main() {
  const { createPgPool } = await import("./pg-client")
  const { resolveDbPath } = await import("../db-path")
  const sqlitePath = process.argv[2] ?? resolveDbPath()
  const pool = createPgPool()
  try {
    const report = await verifyMigration(pool, sqlitePath)
    printReport(report)
    if (!report.ok) process.exit(1)
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
