import { and, eq, or } from "drizzle-orm"
import { createDb, friendships } from "@vortex/db"
import { deriveBlockedUserIds } from "@/lib/social-block-policy"

const db = createDb()

/** Returns true when either participant has blocked the other. */
export async function isBlockedBetweenUsers(
  leftUserId: string,
  rightUserId: string
): Promise<boolean> {
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) return false

  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
      status: friendships.status,
    })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "blocked"),
        or(eq(friendships.requesterId, leftUserId), eq(friendships.addresseeId, leftUserId))
      )
    )

  const blockedIds = deriveBlockedUserIds(leftUserId, rows)
  return blockedIds.has(rightUserId)
}

/** Filters mention ids down to users that are not blocked relative to sender. */
export async function filterMentionsByBlockState(
  senderUserId: string,
  mentions: string[]
): Promise<{ allowed: string[]; blocked: string[] }> {
  const uniqueMentions = Array.from(new Set(mentions.filter(Boolean))).filter((id) => id !== senderUserId)
  if (uniqueMentions.length === 0) return { allowed: [], blocked: [] }

  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
      status: friendships.status,
    })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "blocked"),
        or(eq(friendships.requesterId, senderUserId), eq(friendships.addresseeId, senderUserId))
      )
    )

  const blockedSet = deriveBlockedUserIds(senderUserId, rows)

  return {
    allowed: uniqueMentions.filter((id) => !blockedSet.has(id)),
    blocked: uniqueMentions.filter((id) => blockedSet.has(id)),
  }
}
