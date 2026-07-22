import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

/**
 * Cron job: auto-archive threads that have been inactive longer than
 * their auto_archive_duration (Discord-style).
 *
 * Schedule: every 5 minutes via Vercel cron (see vercel.json).
 */
export async function GET(request: Request) {
  try {
    // Fail closed: require CRON_SECRET to be configured
    if (!process.env.CRON_SECRET) {
      console.error("[thread-auto-archive] CRON_SECRET is not configured")
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const authHeader = request.headers.get("authorization")
    if (!verifyBearerToken(authHeader, process.env.CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const service = await createServiceRoleClient()

    const { data, error } = await service.rpc("auto_archive_inactive_threads")

    if (error) {
      console.error("[thread-auto-archive] RPC failed:", error.message)
      return NextResponse.json({ error: "Failed to archive threads" }, { status: 500 })
    }

    const archivedCount = typeof data === "number" ? data : 0

    if (archivedCount > 0) {
      console.info(`[thread-auto-archive] Archived ${archivedCount} inactive thread(s)`)
    }

    return NextResponse.json({ archived: archivedCount })
  } catch (err) {
    console.error("[cron/thread-auto-archive GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
