import { and, eq, or } from "drizzle-orm"
import { createDb, friendships } from "@vortex/db"

const db = createDb()

type FriendshipStatus = "pending" | "accepted" | "blocked"

type FriendshipRow = {
  requester_id: string
  addressee_id: string
  status: FriendshipStatus
}

/**
 * Centralized policy helper for social surfaces that must suppress blocked users.
 * Returns user ids that are blocked in either direction relative to `userId`.
 */
export async function getBlockedUserIdsForViewer(
  userId: string,
  candidateUserIds?: string[]
): Promise<Set<string>> {
  if (!userId) return new Set<string>()

  const uniqueCandidates = Array.from(new Set((candidateUserIds ?? []).filter(Boolean))).filter((id) => id !== userId)

  let rows: Array<{ requesterId: string; addresseeId: string; status: FriendshipStatus }>
  try {
    rows = await db
      .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId, status: friendships.status })
      .from(friendships)
      .where(and(eq(friendships.status, "blocked"), or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))))
  } catch (error) {
    throw new Error(`Failed to resolve block policy: ${error instanceof Error ? error.message : String(error)}`)
  }

  const blocked = deriveBlockedUserIds(
    userId,
    rows.map((r) => ({ requester_id: r.requesterId, addressee_id: r.addresseeId, status: r.status }))
  )
  if (uniqueCandidates.length === 0) return blocked
  return new Set(uniqueCandidates.filter((id) => blocked.has(id)))
}

export function deriveBlockedUserIds(userId: string, rows: FriendshipRow[]): Set<string> {
  const blocked = new Set<string>()

  for (const row of rows) {
    if (row.status !== "blocked") continue
    if (row.requester_id === userId && row.addressee_id) blocked.add(row.addressee_id)
    if (row.addressee_id === userId && row.requester_id) blocked.add(row.requester_id)
  }

  return blocked
}

export function filterBlockedUserIds<T>(items: T[], getUserId: (item: T) => string | null | undefined, blockedUserIds: Set<string>): T[] {
  if (blockedUserIds.size === 0) return items
  return items.filter((item) => {
    const id = getUserId(item)
    return !id || !blockedUserIds.has(id)
  })
}
