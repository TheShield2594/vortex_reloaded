/**
 * Server-side presence reads.
 *
 * There is exactly one source of truth for whether someone is online: the
 * gateway's Redis presence hashes, written when a Socket.IO connection opens,
 * updated when the client changes status, deleted when the user's last socket
 * closes, and TTL'd so a lost connection ages out (apps/signal/src/presence.ts).
 *
 * `users.status` in SQLite is *not* liveness — it is the status the user
 * picked in the UI (POST /api/presence), persisted so the next session starts
 * out `dnd`/`invisible` again. Serving it as presence is what made every user
 * look permanently online-or-offline depending on which writer ran last
 * (issue #57), so API payloads resolve presence through here instead.
 *
 * When Redis isn't reachable — or isn't configured on the web app at all —
 * there is no liveness signal to serve, so we fall back to the stored status
 * rather than declaring everyone offline.
 */

import { PRESENCE_KEY_PREFIX, toVisibleStatus, type UserStatus } from "@vortex/shared"
import { getRedisClient } from "@/lib/redis-client"

const VALID_STATUSES: readonly string[] = ["online", "idle", "dnd", "invisible", "offline"]

/**
 * Resolves the presence to serve for a user id. `storedStatus` is that user's
 * `users.status` column, used only as the offline-safe fallback described
 * above.
 */
export type PresenceResolver = (userId: string, storedStatus?: string | null) => UserStatus

function normalize(status: string | null | undefined): UserStatus {
  if (typeof status !== "string" || !VALID_STATUSES.includes(status)) return "offline"
  return toVisibleStatus(status as UserStatus)
}

/**
 * Read the gateway's live presence for `userIds`.
 *
 * Returns a map holding only the users who currently have a presence entry —
 * a missing id means offline. Returns `null` when Redis is unavailable, which
 * callers must treat as "liveness unknown", not as "everybody offline".
 */
async function readLivePresence(userIds: string[]): Promise<Map<string, UserStatus> | null> {
  if (userIds.length === 0) return new Map()

  let redis
  try {
    redis = await getRedisClient()
  } catch {
    redis = null
  }
  if (!redis) return null

  try {
    const keys = userIds.map((id) => `${PRESENCE_KEY_PREFIX}:${id}`)
    const values = await redis.hgetMany(keys, "status")
    const live = new Map<string, UserStatus>()
    userIds.forEach((id, i) => {
      const value = values[i]
      if (value === null || value === undefined) return
      // An entry with an unreadable status still proves the user is connected.
      live.set(id, VALID_STATUSES.includes(value) ? toVisibleStatus(value as UserStatus) : "online")
    })
    return live
  } catch (err) {
    console.error("presence: live presence lookup failed", {
      action: "read_live_presence",
      count: userIds.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Build a presence resolver for a set of users, doing the Redis read once for
 * the whole request:
 *
 *   const presence = await createPresenceResolver(members.map((m) => m.id))
 *   members.map((m) => ({ ...m, status: presence(m.id, m.status) }))
 */
export async function createPresenceResolver(
  userIds: Iterable<string>
): Promise<PresenceResolver> {
  const ids = [...new Set(userIds)].filter((id): id is string => typeof id === "string" && id.length > 0)
  const live = await readLivePresence(ids)

  if (!live) {
    // Liveness unknown — the stored status is the best answer available.
    return (_userId, storedStatus) => normalize(storedStatus)
  }
  return (userId) => live.get(userId) ?? "offline"
}
