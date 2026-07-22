import pino from "pino"

/**
 * Structured logger for the Next.js web application.
 *
 * - Production: JSON output for log aggregation tools
 * - Development: Pretty-printed human-readable output
 *
 * Usage:
 *   import { logger } from "@/lib/logger"
 *   logger.info({ serverId, userId }, "Member joined server")
 *   logger.error({ endpoint: "/api/foo", err }, "Request failed")
 *
 * Environment variables:
 *   LOG_LEVEL — pino log level (default: "info" in prod, "debug" in dev)
 */

const isProd = process.env.NODE_ENV === "production"

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  redact: {
    paths: [
      "password", "*.password", "**.password",
      "token", "*.token", "**.token",
      "secret", "*.secret", "**.secret",
      "authorization", "*.authorization",
      "cookie", "*.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
        },
      }),
})

/**
 * Create a child logger scoped to a specific module/area.
 *
 * Usage:
 *   const log = createLogger("api/bans")
 *   log.warn({ serverId }, "Ban rollback failed")
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module })
}
