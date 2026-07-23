import { NextResponse } from "next/server"
import { and, count, eq } from "drizzle-orm"
import { createDb, notifications } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

const db = createDb()

/**
 * GET /api/notifications/unread-count
 *
 * Returns the total unread notification count for the authenticated user.
 * Used by the service worker's periodic background sync to update the
 * PWA app badge (navigator.setAppBadge).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)))

    return NextResponse.json({ count: row?.value ?? 0 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
