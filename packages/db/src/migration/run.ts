import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { exportAllTables } from "./export"
import { importAllTables } from "./import"
import { verifyMigration } from "./verify"
import { exportAuthSecrets } from "./auth-secrets-export"
import { resolveMigrationOutputDir } from "./output-dir"
import { createPgPool } from "./pg-client"

/**
 * End-to-end orchestrator for the migration procedure in issue #7:
 * export -> import -> verify, with an optional auth-secrets pass.
 *
 * Usage:
 *   tsx src/migration/run.ts --dry-run                 # scratch copy, printed report, nothing kept
 *   tsx src/migration/run.ts --dry-run --auth-secrets   # + auth-secrets export
 *   tsx src/migration/run.ts --target /data/vortex.db   # the real cutover — fresh file only
 *   tsx src/migration/run.ts                            # target defaults to DATABASE_URL (db-path.ts)
 *
 * --dry-run always targets a throwaway temp file, ignoring --target/DATABASE_URL,
 * and deletes it when done (pass --keep to inspect it afterward) — this is
 * the "dry-run against a copy first" step issue #7 calls out explicitly,
 * made the deliberately-hard-to-skip path: passing --dry-run can never
 * accidentally write into a real target.
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const withAuthSecrets = args.includes("--auth-secrets")
  const keep = args.includes("--keep")
  const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : undefined

  let targetPath: string
  let scratchDir: string | undefined
  if (dryRun) {
    scratchDir = mkdtempSync(path.join(tmpdir(), "vortex-migration-dry-run-"))
    targetPath = path.join(scratchDir, "dry-run.db")
    console.log(`[dry run] target: ${targetPath}`)
  } else if (targetArg) {
    targetPath = targetArg
  } else {
    const { resolveDbPath } = await import("../db-path")
    targetPath = resolveDbPath()
  }

  const outputDir = resolveMigrationOutputDir()
  const pool = createPgPool()

  try {
    console.log(`\n== 1/${withAuthSecrets ? 4 : 3}: export ==`)
    await exportAllTables(pool, outputDir)

    console.log(`\n== 2/${withAuthSecrets ? 4 : 3}: import ==`)
    await importAllTables(targetPath, outputDir)

    console.log(`\n== 3/${withAuthSecrets ? 4 : 3}: verify ==`)
    const report = await verifyMigration(pool, targetPath)
    for (const t of report.tables) {
      const status = t.countMatches && t.sampleMismatches.length === 0 ? "OK" : "MISMATCH"
      console.log(`  [${status}] ${t.table}: postgres=${t.postgresCount} sqlite=${t.sqliteCount}`)
    }
    if (!report.ok) {
      console.error("\nVerification found mismatches — see above. Not proceeding further.")
      process.exitCode = 1
      return
    }

    if (withAuthSecrets) {
      console.log(`\n== 4/4: auth-secrets export ==`)
      await exportAuthSecrets(pool, outputDir)
    }

    console.log(dryRun ? "\nDry run complete." : "\nMigration complete.")
  } finally {
    await pool.end()
    if (dryRun && scratchDir && !keep) {
      rmSync(scratchDir, { recursive: true, force: true })
    } else if (dryRun && scratchDir && keep) {
      console.log(`(kept dry-run database at ${targetPath})`)
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
