import { NextResponse } from "next/server"
import { and, desc, eq, or } from "drizzle-orm"
import { createDb, friendships, userActivityLog, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { requireAuth } from "@/lib/utils/api-helpers"
import { toSnakeCase } from "@/lib/utils/case"
import type { Database } from "@/types/database"

type UserActivityLogRow = Database["public"]["Tables"]["user_activity_log"]["Row"]

const db = createDb()

const FEED_LIMIT = 10

/**
 * GET /api/users/activity?userId={id}
 * Returns the recent activity feed for a user, respecting their activity_visibility setting:
 *   - public:  anyone (authenticated or not) can see it
 *   - friends: only accepted friends of the viewer can see it
 *   - private: only the user themselves can see it
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get("userId")

    if (!targetUserId) return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 })

    // Fetch the target user's visibility setting
    let targetUser: { id: string; activityVisibility: "public" | "friends" | "private" } | undefined
    try {
      const rows = await db
        .select({ id: users.id, activityVisibility: users.activityVisibility })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1)
      targetUser = rows[0]
    } catch {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const { data: { user: viewer } } = await getBetterAuthUser()
    const viewerIsOwner = viewer?.id === targetUserId

    // Resolve visibility
    if (targetUser.activityVisibility === "private" && !viewerIsOwner) {
      return NextResponse.json({ activity: [], hidden: true })
    }

    if (targetUser.activityVisibility === "friends" && !viewerIsOwner) {
      if (!viewer) return NextResponse.json({ activity: [], hidden: true })
      // Check friendship
      const [friendship] = await db
        .select({ id: friendships.id })
        .from(friendships)
        .where(
          and(
            eq(friendships.status, "accepted"),
            or(
              and(eq(friendships.requesterId, viewer.id), eq(friendships.addresseeId, targetUserId)),
              and(eq(friendships.requesterId, targetUserId), eq(friendships.addresseeId, viewer.id))
            )
          )
        )
        .limit(1)

      if (!friendship) return NextResponse.json({ activity: [], hidden: true })
    }

    let activity
    try {
      activity = await db
        .select({
          id: userActivityLog.id,
          eventType: userActivityLog.eventType,
          summary: userActivityLog.summary,
          refId: userActivityLog.refId,
          refType: userActivityLog.refType,
          refLabel: userActivityLog.refLabel,
          refUrl: userActivityLog.refUrl,
          createdAt: userActivityLog.createdAt,
        })
        .from(userActivityLog)
        .where(eq(userActivityLog.userId, targetUserId))
        .orderBy(desc(userActivityLog.createdAt))
        .limit(FEED_LIMIT)
    } catch {
      return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
    }

    return NextResponse.json({ activity: toSnakeCase<UserActivityLogRow[]>(activity) })

  } catch (err) {
    console.error("[users/activity GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/users/activity — update activity_visibility setting for the authenticated user
 * Body: { visibility: "public" | "friends" | "private" }
 */
export async function PATCH(request: Request) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const body = await request.json().catch(() => null)
    const visibility = body?.visibility
    if (!["public", "friends", "private"].includes(visibility)) {
      return NextResponse.json({ error: "visibility must be one of: public, friends, private" }, { status: 422 })
    }

    let row: { id: string; activityVisibility: "public" | "friends" | "private" } | undefined
    try {
      const rows = await db
        .update(users)
        .set({ activityVisibility: visibility })
        .where(eq(users.id, user.id))
        .returning({ id: users.id, activityVisibility: users.activityVisibility })
      row = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to update activity visibility" }, { status: 500 })
    }

    if (!row) return NextResponse.json({ error: "Failed to update activity visibility" }, { status: 500 })
    return NextResponse.json(toSnakeCase<{ id: string; activity_visibility: string }>(row))

  } catch (err) {
    console.error("[users/activity PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
