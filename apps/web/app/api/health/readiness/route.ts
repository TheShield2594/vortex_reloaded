import { NextResponse } from "next/server"
import { createDb, users } from "@vortex/db"

const db = createDb()

/**
 * GET /api/health/readiness
 * Readiness probe — verifies the app can reach the SQLite DB.
 * Returns 200 when ready, 503 when a dependency is unreachable.
 */
export async function GET() {
  const start = Date.now()
  let dbOk = false

  try {
    await db.select({ id: users.id }).from(users).limit(1)
    dbOk = true
  } catch {
    dbOk = false
  }

  const latencyMs = Date.now() - start

  if (!dbOk) {
    return NextResponse.json(
      { status: "degraded", db: "unreachable", latency_ms: latencyMs },
      { status: 503 },
    )
  }

  return NextResponse.json({
    status: "ok",
    db: "connected",
    latency_ms: latencyMs,
  })
}
