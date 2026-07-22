FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace root files needed for npm workspace resolution
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/signal/package.json ./apps/signal/package.json

# Install all workspace dependencies (signal + shared)
RUN npm ci --workspace=apps/signal --workspace=packages/shared --include-workspace-root

# Copy source files
COPY packages/shared ./packages/shared
COPY apps/signal ./apps/signal

# Build shared package first, then signal
RUN npm run build --workspace=packages/shared && \
    npm run build --workspace=apps/signal

# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/signal/package.json ./apps/signal/package.json

RUN npm ci --workspace=apps/signal --workspace=packages/shared --include-workspace-root --omit=dev

# Copy built artifacts
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/apps/signal/dist ./apps/signal/dist

# Point shared package entry to compiled output for runtime resolution
# Reads publishConfig as the single source of truth for dist entry points
RUN node -e "const fs=require('fs'); const p=require('./packages/shared/package.json'); const { publishConfig } = p; p.main=publishConfig.main; p.types=publishConfig.types; p.exports=publishConfig.exports; fs.writeFileSync('./packages/shared/package.json', JSON.stringify(p, null, 2))"

ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 signaluser
USER signaluser

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http'); const port=process.env.PORT||3001; http.get('http://127.0.0.1:'+port+'/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

EXPOSE 3001
CMD ["node", "apps/signal/dist/index.js"]
