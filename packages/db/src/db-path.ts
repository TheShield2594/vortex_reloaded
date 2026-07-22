import path from "node:path"

// Resolved from this file's own location (not process.cwd(), which varies by
// caller) so every consumer — client.ts, migrate.ts, drizzle.config.ts —
// defaults to the same on-disk file regardless of where it's invoked from.
const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "vortex.db")

/**
 * `DATABASE_URL` follows the `file:<path>` convention already established by
 * scripts/setup.sh and docker-compose.yml (e.g. `file:/data/vortex.db`,
 * the bind-mounted volume shared between `apps/web` and `apps/signal`).
 */
export function resolveDbPath(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return DEFAULT_DB_PATH

  if (!url.startsWith("file:")) {
    throw new Error(`DATABASE_URL must start with "file:" (got: "${url}")`)
  }

  return path.resolve(url.slice("file:".length))
}
