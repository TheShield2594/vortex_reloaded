import type { SupabaseClient } from "@supabase/supabase-js"
import { getBlockedUserIdsForViewer } from "@/lib/social-block-policy"

/** Returns true when either participant has blocked the other. */
export async function isBlockedBetweenUsers(
  supabase: SupabaseClient,
  leftUserId: string,
  rightUserId: string
): Promise<boolean> {
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) return false
  const blockedIds = await getBlockedUserIdsForViewer(supabase, leftUserId, [rightUserId])
  return blockedIds.has(rightUserId)
}

/** Filters mention ids down to users that are not blocked relative to sender. */
export async function filterMentionsByBlockState(
  supabase: SupabaseClient,
  senderUserId: string,
  mentions: string[]
): Promise<{ allowed: string[]; blocked: string[] }> {
  const uniqueMentions = Array.from(new Set(mentions.filter(Boolean))).filter((id) => id !== senderUserId)
  if (uniqueMentions.length === 0) return { allowed: [], blocked: [] }

  const blockedSet = await getBlockedUserIdsForViewer(supabase, senderUserId, uniqueMentions)

  return {
    allowed: uniqueMentions.filter((id) => !blockedSet.has(id)),
    blocked: uniqueMentions.filter((id) => blockedSet.has(id)),
  }
}
