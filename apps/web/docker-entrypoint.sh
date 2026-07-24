#!/bin/sh
set -e

##############################################################################
#  VortexChat web container entrypoint
#
#  Creates/updates the SQLite schema before the app starts, so a fresh
#  self-hosted install boots against a fully-migrated database instead of an
#  empty ./data/vortex.db. Idempotent and safe to run on every start:
#  drizzle tracks which table migrations it has applied, and every FTS5 /
#  trigger statement in fts5-and-triggers.sql uses IF NOT EXISTS.
#
#  DATABASE_URL (file:/data/vortex.db by default in docker-compose.yml) tells
#  migrate.js where the file lives.
##############################################################################

echo "[entrypoint] Applying database migrations (${DATABASE_URL:-default path})..."
node /app/packages/db/dist/migrate.js

echo "[entrypoint] Starting: $*"
exec "$@"
