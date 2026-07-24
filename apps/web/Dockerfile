FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# python3/make/g++ are required to build better-sqlite3's native addon on
# Alpine (musl) — there is no prebuilt binary for this platform, so it
# compiles from source during `npm ci`.
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Copy workspace root + package manifests for all workspaces
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace=apps/web --workspace=packages/shared --workspace=packages/db --include-workspace-root

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/web ./apps/web

# Build shared package first
RUN npm run build --workspace=packages/shared 2>/dev/null || true

# Compile @vortex/db to dist/. next build resolves @vortex/db from source, but
# the runtime schema migration (docker-entrypoint.sh) needs a plain-JS entry
# point (dist/migrate.js) plus the copied .sql files it reads at run time.
RUN npm run build --workspace=packages/db

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
WORKDIR /app/apps/web
RUN npx next build
WORKDIR /app

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Next's standalone output tracing sometimes misses native addons like
# better-sqlite3's compiled .node binary — copy the whole package explicitly
# from `deps` so the runtime image has it regardless of tracing behavior.
# better-sqlite3 is pulled in through an `eval("require")` (see
# packages/db/src/client.ts), which hides it — and its runtime deps
# (bindings → file-uri-to-path) — from Next's static import tracer, so those
# have to come along too or the .node binding fails to load at run time.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# @vortex/db's compiled migration runner + its runtime dep (drizzle-orm has no
# further deps) and the migration SQL, so docker-entrypoint.sh can create the
# schema on boot. migrate.js reads ../migrations and ./dist/sql relative to
# dist/, so both are copied alongside it.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/migrations ./packages/db/migrations

# Entrypoint applies pending migrations, then starts the server.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/docker-entrypoint.sh ./docker-entrypoint.sh

# Mount point for the SQLite database file (see docker-compose.yml — bind
# mounted from the host so it's a plain file, easy to snapshot/back up).
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME ["/data"]

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
