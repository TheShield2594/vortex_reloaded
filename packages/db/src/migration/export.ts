import { appendFileSync, writeFileSync } from "node:fs"
import type { Pool } from "pg"
import { MIGRATION_TABLES, type TableSpec } from "./tables"
import { toPortableRow } from "./transform"
import { resolveMigrationOutputDir, tableDumpPath } from "./output-dir"

const BATCH_SIZE = 2000

/**
 * Step 1 of the migration procedure (issue #7): `SELECT *` each of the 28
 * live tables directly from Supabase Postgres — not `pg_dump`, so rows can
 * be transformed inline — and write one NDJSON file per table.
 *
 * Simple LIMIT/OFFSET pagination, not keyset. That's a deliberate
 * simplicity-over-throughput tradeoff for a script that runs a handful of
 * times total (dry run + real cutover) against an app-scale dataset, not a
 * recurring job — see the runbook doc if a table ever grows large enough
 * that OFFSET pagination's cost becomes worth revisiting.
 */
export async function exportTable(pool: Pool, table: TableSpec, outputDir: string): Promise<number> {
  const dumpPath = tableDumpPath(outputDir, table.name)
  writeFileSync(dumpPath, "")

  const orderBy = table.orderBy.map((c) => `"${c}"`).join(", ")
  let offset = 0
  let total = 0

  for (;;) {
    const { rows } = await pool.query(
      `SELECT * FROM "public"."${table.name}" ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    )
    if (rows.length === 0) break

    const lines = rows.map((row) => JSON.stringify(toPortableRow(row))).join("\n") + "\n"
    appendFileSync(dumpPath, lines)

    total += rows.length
    offset += BATCH_SIZE
    if (rows.length < BATCH_SIZE) break
  }

  return total
}

export async function exportAllTables(
  pool: Pool,
  outputDir: string = resolveMigrationOutputDir()
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of MIGRATION_TABLES) {
    const count = await exportTable(pool, table, outputDir)
    counts[table.name] = count
    console.log(`  exported ${table.name}: ${count} rows`)
  }
  return counts
}

async function main() {
  const { createPgPool } = await import("./pg-client")
  const pool = createPgPool()
  const outputDir = resolveMigrationOutputDir()
  console.log(`Exporting ${MIGRATION_TABLES.length} tables to ${outputDir}`)
  try {
    const counts = await exportAllTables(pool, outputDir)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    console.log(`Done: ${total} rows across ${MIGRATION_TABLES.length} tables`)
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
