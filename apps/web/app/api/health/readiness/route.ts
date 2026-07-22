import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * GET /api/health/readiness
 * Readiness probe — verifies the app can reach Supabase/DB.
 * Returns 200 when ready, 503 when a dependency is unreachable.
 * Uses the anon-key client (no service-role key exposure).
 */
export async function GET() {
  const start = Date.now()
  let dbOk = false

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.from("users").select("id", { count: "exact", head: true }).limit(0)
    dbOk = !error
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
