import { NextResponse } from "next/server"
import { desc, eq, or } from "drizzle-orm"
import { createDb, directMessages, friendships, userNotificationPreferences, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"
import type { Database } from "@/types/database"

type UserNotificationPreferencesRow = Database["public"]["Tables"]["user_notification_preferences"]["Row"]

const db = createDb()

/**
 * GET /api/users/export
 *
 * GDPR data export — returns a JSON file containing all user-owned data:
 * profile, DMs, friend list, notification preferences.
 *
 * Server/channel messaging (`messages`, `server_members`, message `reactions`)
 * was retired entirely during the SQLite migration (issue #36) — those
 * tables no longer exist anywhere in this stack, so those sections are
 * always empty rather than querying a data source that's gone.
 *
 * Rate limited: one export per 24 hours via client-side gating + server check.
 */
export async function GET() {
  try {
  const { data: { user } } = await getBetterAuthUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = user.id

  // Rate limit: one export per 24 hours
  const { rateLimiter } = await import("@/lib/rate-limit")
  const rl = await rateLimiter.check(`export:${userId}`, { limit: 1, windowMs: 24 * 60 * 60 * 1000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Export rate limit exceeded. Please try again in 24 hours." },
      { status: 429 }
    )
  }

  // Gather all user-owned data in parallel
  let profileRows, dmMessagesRows, friendsRows, notifPrefsRows
  try {
    ;[profileRows, dmMessagesRows, friendsRows, notifPrefsRows] = await Promise.all([
      // Profile
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          bio: users.bio,
          avatarUrl: users.avatarUrl,
          bannerColor: users.bannerColor,
          status: users.status,
          statusMessage: users.statusMessage,
          statusEmoji: users.statusEmoji,
          customTag: users.customTag,
          onboardingCompletedAt: users.onboardingCompletedAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      // DM messages (last 10k)
      db
        .select({
          id: directMessages.id,
          dmChannelId: directMessages.dmChannelId,
          content: directMessages.content,
          createdAt: directMessages.createdAt,
        })
        .from(directMessages)
        .where(eq(directMessages.senderId, userId))
        .orderBy(desc(directMessages.createdAt))
        .limit(10000),
      // Friends
      db
        .select({
          id: friendships.id,
          requesterId: friendships.requesterId,
          addresseeId: friendships.addresseeId,
          status: friendships.status,
          createdAt: friendships.createdAt,
        })
        .from(friendships)
        .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))),
      // Notification preferences
      db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1),
    ])
  } catch {
    return NextResponse.json(
      { error: "Failed to gather export data" },
      { status: 500 }
    )
  }

  const profile = profileRows[0]
  const notifPrefs = notifPrefsRows[0]

  const exportData = {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile: profile ? toSnakeCase(profile) : null,
    messages: {
      count: 0,
      items: [] as unknown[],
    },
    direct_messages: {
      count: dmMessagesRows.length,
      items: toSnakeCase(dmMessagesRows),
    },
    friendships: toSnakeCase(friendsRows),
    server_memberships: [] as unknown[],
    notification_preferences: notifPrefs ? toSnakeCase<UserNotificationPreferencesRow>(notifPrefs) : null,
    reactions: {
      count: 0,
      items: [] as unknown[],
    },
  }

  const body = JSON.stringify(exportData, null, 2)

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="vortexchat-export-${userId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
