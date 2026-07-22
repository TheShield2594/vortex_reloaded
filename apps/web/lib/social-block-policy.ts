import type { SupabaseClient } from "@supabase/supabase-js"

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
  supabase: SupabaseClient,
  userId: string,
  candidateUserIds?: string[]
): Promise<Set<string>> {
  if (!userId) return new Set<string>()

  const uniqueCandidates = Array.from(new Set((candidateUserIds ?? []).filter(Boolean))).filter((id) => id !== userId)

  let query = supabase
    .from("friendships")
    .select("requester_id, addressee_id, status")
    .eq("status", "blocked")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to resolve block policy: ${error.message}`)
  }

  const blocked = deriveBlockedUserIds(userId, data ?? [])
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
