/**
 * `DATABASE_URL` follows the `file:<path>` convention already established by
 * scripts/setup.sh and docker-compose.yml (e.g. `file:/data/vortex.db`,
 * the bind-mounted volume shared between `apps/web` and `apps/signal`).
 */
export function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/vortex.db"
  return url.startsWith("file:") ? url.slice("file:".length) : url
}
