import { NextResponse } from "next/server"

/**
 * GET /api/health
 * Liveness probe — returns 200 immediately with no external checks.
 * Orchestrators should use this to decide whether to restart the process.
 */
export async function GET() {
  try {
    return NextResponse.json({ status: "ok" })

  } catch (err) {
    console.error("[health GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
