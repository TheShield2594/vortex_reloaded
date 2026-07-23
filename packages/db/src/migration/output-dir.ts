import { mkdirSync } from "node:fs"
import path from "node:path"

/**
 * Where NDJSON table dumps and the auth-secrets staging file land. Never
 * committed (see the repo .gitignore) — this holds raw exported user data,
 * including the auth-secrets file's password hashes and TOTP secrets.
 */
export function resolveMigrationOutputDir(): string {
  const dir = process.env.MIGRATION_OUTPUT_DIR?.trim() || path.resolve(__dirname, "..", "..", ".migration-output")
  mkdirSync(dir, { recursive: true })
  return dir
}

export function tableDumpPath(outputDir: string, table: string): string {
  return path.join(outputDir, `${table}.ndjson`)
}
