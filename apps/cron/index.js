/**
 * VortexChat Cron Runner
 *
 * Portable replacement for Vercel Cron. Calls the web app's cron HTTP
 * endpoints on a schedule, authenticated with CRON_SECRET.
 *
 * Required env vars:
 *   WEB_URL       — base URL of the web app (e.g. http://web:3000)
 *   CRON_SECRET   — shared secret for authenticating cron requests
 *
 * Optional env vars:
 *   LOG_LEVEL     — "debug" | "info" | "warn" | "error" (default: "info")
 */

import cron from "node-cron"
import { createServer } from "node:http"

const WEB_URL = process.env.WEB_URL?.replace(/\/$/, "")
const CRON_SECRET = process.env.CRON_SECRET

if (!WEB_URL) {
  console.error("[cron] WEB_URL is required (e.g. http://web:3000)")
  process.exit(1)
}
if (!CRON_SECRET) {
  console.error("[cron] CRON_SECRET is required")
  process.exit(1)
}

const LOG_LEVEL = process.env.LOG_LEVEL || "info"
const levels = { debug: 0, info: 1, warn: 2, error: 3 }
const logLevel = levels[LOG_LEVEL] ?? 1

function log(level, ...args) {
  if (levels[level] >= logLevel) {
    const ts = new Date().toISOString()
    console[level === "debug" ? "log" : level](`[${ts}] [cron] [${level}]`, ...args)
  }
}

/**
 * Call a cron endpoint with retries.
 */
async function callEndpoint(path, retries = 2) {
  const url = `${WEB_URL}${path}`
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      log("info", `→ ${path} (attempt ${attempt})`)
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
          "User-Agent": "VortexCron/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      })
      const body = await res.text()
      if (res.ok) {
        log("info", `✓ ${path} ${res.status}`, body.slice(0, 200))
        return
      }
      log("warn", `✗ ${path} ${res.status}`, body.slice(0, 200))
    } catch (err) {
      log("error", `✗ ${path} error:`, err.message || String(err))
    }
    if (attempt <= retries) {
      const delay = attempt * 2000
      log("debug", `  retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  log("error", `✗ ${path} failed after ${retries + 1} attempts`)
}

// ─── Schedule definitions ───────────────────────────────────────────────────

const jobs = [
  {
    name: "scheduled-tasks",
    path: "/api/cron/scheduled-tasks",
    schedule: "0 0 * * *",          // Daily at midnight UTC
    description: "Event reminders, thread auto-archive, attachment decay",
  },
  {
    name: "presence-cleanup",
    path: "/api/cron/presence-cleanup",
    schedule: "*/2 * * * *",         // Every 2 minutes (self-hosted can afford this)
    description: "Mark stale users as offline",
  },
  {
    name: "thread-auto-archive",
    path: "/api/cron/thread-auto-archive",
    schedule: "*/5 * * * *",         // Every 5 minutes
    description: "Archive inactive threads",
  },
]

// ─── Start ──────────────────────────────────────────────────────────────────

console.log("┌─────────────────────────────────────────────┐")
console.log("│  VortexChat Cron Runner                     │")
console.log("├─────────────────────────────────────────────┤")
console.log(`│  Web URL: ${WEB_URL.padEnd(33)}│`)
console.log(`│  Jobs:    ${String(jobs.length).padEnd(33)}│`)
console.log("└─────────────────────────────────────────────┘")

const scheduledTasks = []

for (const job of jobs) {
  const task = cron.schedule(job.schedule, () => callEndpoint(job.path), {
    timezone: "UTC",
  })
  scheduledTasks.push(task)
  log("info", `Scheduled: ${job.name} [${job.schedule}] — ${job.description}`)
}

// Healthcheck: simple HTTP server for Docker HEALTHCHECK
const healthPort = parseInt(process.env.HEALTH_PORT || "3002", 10)
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", jobs: jobs.length }))
  } else {
    res.writeHead(404)
    res.end()
  }
})
server.listen(healthPort, () => {
  log("info", `Health endpoint listening on :${healthPort}/health`)
})

// Graceful shutdown
function shutdown(signal) {
  log("info", `Received ${signal}, shutting down...`)
  scheduledTasks.forEach(task => task.stop())
  server.close(() => process.exit(0))
  // Force exit after 5s if server.close hangs
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
