import { NextRequest, NextResponse } from "next/server"
import { and, inArray, isNull, lt, or } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { PRESENCE_STALE_THRESHOLD_MS } from "@vortex/shared"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

const db = createDb()

/**
 * GET /api/cron/presence-cleanup
 *
 * Server-side presence garbage collector. Finds users whose last heartbeat
 * exceeds the stale threshold and marks them offline. This is the safety net
 * that ensures users are marked offline even when:
 *
 * - The browser crashes (no beforeunload / sendBeacon)
 * - The network drops silently
 * - The mobile OS kills the tab in the background
 * - The user force-quits the app
 *
 * Modeled after Fluxer's server-side disconnect detection where the gateway
 * process monitors session liveness and marks users offline on timeout.
 *
 * Runs daily via Vercel Cron as a fallback. For more frequent execution,
 * use an external scheduler (e.g. cron-job.org) to call this route
 * every 1–2 minutes with CRON_SECRET. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const authHeader = req.headers.get("authorization")
    if (!verifyBearerToken(authHeader, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()
    const staleThreshold = new Date(now.getTime() - PRESENCE_STALE_THRESHOLD_MS).toISOString()

    // Find users who are marked online/idle/dnd but have a stale (or null)
    // heartbeat. Invisible users are excluded — they intentionally appear offline
    // and still heartbeat to maintain their session.
    // NULL last_heartbeat_at means the user was set online before the heartbeat
    // system was deployed — treat as stale.
    let staleUsers: { id: string; status: string; lastHeartbeatAt: string | null }[]
    try {
      staleUsers = await db
        .select({ id: users.id, status: users.status, lastHeartbeatAt: users.lastHeartbeatAt })
        .from(users)
        .where(
          and(
            inArray(users.status, ["online", "idle", "dnd"]),
            or(isNull(users.lastHeartbeatAt), lt(users.lastHeartbeatAt, staleThreshold))
          )
        )
        .limit(500)
    } catch (queryError) {
      console.error("presence-cleanup: query failed", {
        route: "cron/presence-cleanup",
        error: queryError instanceof Error ? queryError.message : queryError,
      })
      return NextResponse.json({ error: "Query failed" }, { status: 500 })
    }

    if (!staleUsers || staleUsers.length === 0) {
      return NextResponse.json({ ok: true, cleaned: 0 })
    }

    const staleIds = staleUsers.map((u) => u.id)

    // Batch update stale users to offline.
    // The SELECT already filtered by stale heartbeat, so we only need to
    // re-check heartbeat in the UPDATE to guard against a race where a user
    // heartbeated between the SELECT and this UPDATE.
    // Process in batches of 50 to avoid query-string length limits.
    let cleanedCount = 0
    const BATCH_SIZE = 50
    for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
      const batch = staleIds.slice(i, i + BATCH_SIZE)
      try {
        const rows = await db
          .update(users)
          .set({
            status: "offline" as const,
            updatedAt: now,
            lastOnlineAt: now.toISOString(),
          })
          .where(
            and(
              inArray(users.id, batch),
              or(isNull(users.lastHeartbeatAt), lt(users.lastHeartbeatAt, staleThreshold))
            )
          )
          .returning({ id: users.id })
        cleanedCount += rows.length
      } catch (updateError) {
        console.error("presence-cleanup: update failed", {
          route: "cron/presence-cleanup",
          error: updateError instanceof Error ? updateError.message : updateError,
          batchIndex: i,
        })
        // Continue with remaining batches rather than aborting
        continue
      }
    }

    console.log("presence-cleanup: marked users offline", {
      route: "cron/presence-cleanup",
      count: cleanedCount,
    })

    return NextResponse.json({ ok: true, cleaned: cleanedCount })
  } catch (err) {
    console.error("presence-cleanup: unexpected error", {
      route: "cron/presence-cleanup",
      error: err,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
