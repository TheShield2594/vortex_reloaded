import { appendFileSync, writeFileSync } from "node:fs"
import type { Pool, PoolClient } from "pg"
import { MIGRATION_TABLES, type TableSpec } from "./tables"
import { toPortableRow } from "./transform"
import { resolveMigrationOutputDir, tableDumpPath } from "./output-dir"

const BATCH_SIZE = 2000

/** Either a `Pool` or a single checked-out `PoolClient` — both expose `.query()`. */
type Queryable = Pick<Pool | PoolClient, "query">

/**
 * Step 1 of the migration procedure (issue #7): `SELECT *` each of the 28
 * live tables directly from Supabase Postgres — not `pg_dump`, so rows can
 * be transformed inline — and write one NDJSON file per table.
 *
 * Simple LIMIT/OFFSET pagination, not keyset. That's a deliberate
 * simplicity-over-throughput tradeoff for a script that runs a handful of
 * times total (dry run + real cutover) against an app-scale dataset, not a
 * recurring job — see the runbook doc if a table ever grows large enough
 * that OFFSET pagination's cost becomes worth revisiting. Snapshot
 * consistency across pages/tables is exportAllTables()'s job, not this
 * function's — see its module comment.
 */
export async function exportTable(client: Queryable, table: TableSpec, outputDir: string): Promise<number> {
  const dumpPath = tableDumpPath(outputDir, table.name)
  writeFileSync(dumpPath, "")

  const orderBy = table.orderBy.map((c) => `"${c}"`).join(", ")
  let offset = 0
  let total = 0

  for (;;) {
    const { rows } = await client.query(
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

/**
 * Runs every table's export against one `REPEATABLE READ, READ ONLY`
 * transaction on a single checked-out connection. Without this, each
 * `exportTable` call — and each LIMIT/OFFSET page within it — would run as
 * its own query against whatever the live table looks like *at that moment*:
 * concurrent writes could shift OFFSET-based pages (skipping or duplicating
 * rows within one table) or leave a child row exported against a snapshot
 * where its parent row didn't exist yet (a `dm_channel_members` row for a
 * `dm_channels` row created after that table's export already ran). A single
 * transaction's snapshot is fixed at `BEGIN`, so every table and every page
 * sees the exact same consistent point in time — the practical equivalent of
 * the "freeze writes for the cutover window" operational alternative, without
 * depending on that being followed correctly.
 */
export async function exportAllTables(
  pool: Pool,
  outputDir: string = resolveMigrationOutputDir()
): Promise<Record<string, number>> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

    const counts: Record<string, number> = {}
    for (const table of MIGRATION_TABLES) {
      const count = await exportTable(client, table, outputDir)
      counts[table.name] = count
      console.log(`  exported ${table.name}: ${count} rows`)
    }

    await client.query("COMMIT")
    return counts
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
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
