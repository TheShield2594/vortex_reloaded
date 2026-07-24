import { NextRequest, NextResponse } from "next/server"
import { and, asc, eq, gt, or } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { createDb, friendships, notifications, userNotificationPreferences, users } from "@vortex/db"
import { sendPushToUser } from "@/lib/push"
import { requireAuth, checkRateLimit } from "@/lib/utils/api-helpers"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import { createPresenceResolver } from "@/lib/presence"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

// Two aliases of `users` so a single query can pull both sides of the
// friendship — Drizzle has no PostgREST-style embedded-join sugar, so this
// stands in for the old `requester:users!friendships_requester_id_fkey(*)`
// / `addressee:users!friendships_addressee_id_fkey(*)` embeds.
const requesterUsers = alias(users, "requester_users")
const addresseeUsers = alias(users, "addressee_users")

// GET /api/friends
// Returns { accepted: FriendWithUser[], pending_received: FriendWithUser[], pending_sent: FriendWithUser[], blocked: FriendWithUser[] }
export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    // Pagination: cursor-based on friendship id
    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100", 10), 1), 500)
    const afterCursor = searchParams.get("after") // friendship id cursor

    const conditions = [or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id))]
    if (afterCursor) conditions.push(gt(friendships.id, afterCursor))

    const allRows = await db
      .select({
        id: friendships.id,
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
        createdAt: friendships.createdAt,
        updatedAt: friendships.updatedAt,
        requester: requesterUsers,
        addressee: addresseeUsers,
      })
      .from(friendships)
      .leftJoin(requesterUsers, eq(friendships.requesterId, requesterUsers.id))
      .leftJoin(addresseeUsers, eq(friendships.addresseeId, addresseeUsers.id))
      .where(and(...conditions))
      .orderBy(asc(friendships.id))
      .limit(limit + 1)

    type FriendRow = (typeof allRows)[number]
    type FriendEntry = FriendRow & { friend: FriendRow["requester"] }

    const accepted: FriendEntry[] = []
    const pending_received: FriendEntry[] = []
    const pending_sent: FriendEntry[] = []
    const blocked: FriendEntry[] = []

    const hasMore = allRows.length > limit
    const pageRows = hasMore ? allRows.slice(0, limit) : allRows

    for (const row of pageRows) {
      const isRequester = row.requesterId === user.id
      const friend = isRequester ? row.addressee : row.requester
      const entry: FriendEntry = { ...row, friend }

      if (row.status === "accepted") {
        accepted.push(entry)
      } else if (row.status === "pending") {
        if (isRequester) pending_sent.push(entry)
        else pending_received.push(entry)
      } else if (row.status === "blocked" && isRequester) {
        // Only show blocks the current user initiated
        blocked.push(entry)
      }
    }

    const lastRow = pageRows[pageRows.length - 1]
    const nextCursor = hasMore && lastRow ? lastRow.id : null

    // The friends list is the app's main presence surface. Liveness lives in
    // the gateway, so users.status on these rows is replaced with what the
    // gateway knows (issue #57).
    const presence = await createPresenceResolver(
      pageRows.flatMap((row) =>
        [row.requester?.id, row.addressee?.id].filter((id): id is string => !!id)
      )
    )
    function withPresence<T extends { id: string; status: string } | null>(profile: T): T {
      if (!profile) return profile
      return { ...profile, status: presence(profile.id, profile.status) }
    }
    const resolved = (entries: FriendEntry[]): FriendEntry[] =>
      entries.map((entry) => ({
        ...entry,
        requester: withPresence(entry.requester),
        addressee: withPresence(entry.addressee),
        friend: withPresence(entry.friend),
      }))

    return NextResponse.json(
      toSnakeCase({
        accepted: resolved(accepted),
        pending_received: resolved(pending_received),
        pending_sent: resolved(pending_sent),
        blocked: resolved(blocked),
        next_cursor: nextCursor,
      })
    )
  } catch (err) {
    console.error("[friends GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/friends  { username: string }
// Send a friend request by username
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const limited = await checkRateLimit(user.id, "friends:request", { limit: 20, windowMs: 3600_000 })
    if (limited) return limited

    const { username } = await req.json()
    if (!username?.trim()) return NextResponse.json({ error: "Username required" }, { status: 400 })

    // Normalize response message — always return the same message regardless of
    // whether the target user exists to prevent username enumeration (issue #543).
    const GENERIC_SUCCESS = "Friend request sent (if user exists)"

    // Find target user — intentionally bypass discoverability policy to allow friend
    // requests to non-discoverable users by exact username match; this trades privacy
    // for convenience, mitigated by a strict 20 req/hr rate limit plus normalized
    // responses below.
    let target: { id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string } | undefined
    try {
      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          status: users.status,
        })
        .from(users)
        .where(eq(users.username, username.trim().toLowerCase()))
        .limit(1)
      target = rows[0]
    } catch (err) {
      // Return generic success to avoid leaking DB errors vs. user-not-found
      console.error("friends POST: user lookup failed", { actorId: user.id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ message: GENERIC_SUCCESS })
    }
    if (!target) {
      return NextResponse.json({ message: GENERIC_SUCCESS })
    }

    if (target.id === user.id) {
      // Self-add is a client input error — safe to reveal
      return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 })
    }

    // Check if friendship already exists in either direction
    const [existing] = await db
      .select({ id: friendships.id, status: friendships.status, requesterId: friendships.requesterId })
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, target.id)),
          and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, user.id))
        )
      )
      .limit(1)

    if (existing) {
      if (existing.status === "accepted") {
        // Already friends — return generic to avoid confirming username exists
        return NextResponse.json({ message: GENERIC_SUCCESS })
      }
      if (existing.status === "pending") {
        if (existing.requesterId === target.id) {
          // They already sent us a request — auto-accept
          try {
            await db.update(friendships).set({ status: "accepted" }).where(eq(friendships.id, existing.id))
          } catch {
            return NextResponse.json({ error: "Failed to send request" }, { status: 500 })
          }

          // Notify the original requester that their request was auto-accepted (fire-and-forget)
          Promise.resolve().then(async () => {
            const [accepter] = await db
              .select({ displayName: users.displayName, username: users.username, avatarUrl: users.avatarUrl })
              .from(users)
              .where(eq(users.id, user.id))
              .limit(1)
            const accepterName = accepter?.displayName || accepter?.username || "Someone"
            const [prefs] = await db
              .select({ friendRequestNotifications: userNotificationPreferences.friendRequestNotifications })
              .from(userNotificationPreferences)
              .where(eq(userNotificationPreferences.userId, target.id))
              .limit(1)
            if (prefs && prefs.friendRequestNotifications === false) return
            const [notif] = await db
              .insert(notifications)
              .values({
                userId: target.id,
                type: "friend_request",
                title: `${accepterName} accepted your friend request`,
                body: "You can now message each other.",
                iconUrl: accepter?.avatarUrl ?? null,
              })
              .returning()
            if (notif) {
              await publishGatewayEvent({
                type: "notification.created",
                channelId: `user:${target.id}`,
                actorId: user.id,
                data: toSnakeCase(notif),
              }, { route: "/api/friends" })
            }
            await sendPushToUser(target.id, {
              title: "Friend Request Accepted",
              body: `${accepterName} accepted your friend request`,
              url: "/channels/me",
              tag: `friend-accepted-${user.id}`,
            })
          }).catch((err) => { console.error("friends POST: auto-accept notification failed", { actorId: user.id, targetId: target.id }, err) })

          return NextResponse.json({ message: "Friend request accepted" })
        }
        // Already sent — return generic to avoid confirming username
        return NextResponse.json({ message: GENERIC_SUCCESS })
      }
      if (existing.status === "blocked") {
        // Blocked — return generic to avoid confirming username
        return NextResponse.json({ message: GENERIC_SUCCESS })
      }
    }

    try {
      await db.insert(friendships).values({ requesterId: user.id, addresseeId: target.id, status: "pending" })
    } catch {
      return NextResponse.json({ error: "Failed to send request" }, { status: 500 })
    }

    // Notify the addressee of the incoming friend request (fire-and-forget)
    Promise.resolve().then(async () => {
      const [sender] = await db
        .select({ displayName: users.displayName, username: users.username, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)
      const senderName = sender?.displayName || sender?.username || "Someone"

      // Check if addressee has friend_request notifications enabled (default true)
      const [prefs] = await db
        .select({ friendRequestNotifications: userNotificationPreferences.friendRequestNotifications })
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, target.id))
        .limit(1)

      if (prefs && prefs.friendRequestNotifications === false) return

      const [notif] = await db
        .insert(notifications)
        .values({
          userId: target.id,
          type: "friend_request",
          title: `${senderName} sent you a friend request`,
          body: "Accept or decline in the Friends section.",
          iconUrl: sender?.avatarUrl ?? null,
        })
        .returning()
      if (notif) {
        await publishGatewayEvent({
          type: "notification.created",
          channelId: `user:${target.id}`,
          actorId: user.id,
          data: toSnakeCase(notif),
        }, { route: "/api/friends" })
      }

      await sendPushToUser(target.id, {
        title: "New Friend Request",
        body: `${senderName} sent you a friend request`,
        url: "/channels/me",
        tag: `friend-request-${user.id}`,
      })
    }).catch((err) => { console.error("friends POST: new-request notification failed", { actorId: user.id, targetId: target.id }, err) })

    return NextResponse.json({ message: GENERIC_SUCCESS })
  } catch (err) {
    console.error("[friends POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/friends  { friendshipId: string, action: "accept" | "decline" | "block" }
export async function PATCH(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { friendshipId, action } = await req.json()
    if (!friendshipId || !action) {
      return NextResponse.json({ error: "friendshipId and action required" }, { status: 400 })
    }

    const [row] = await db
      .select({
        id: friendships.id,
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
      })
      .from(friendships)
      .where(eq(friendships.id, friendshipId))
      .limit(1)

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isInvolved = row.requesterId === user.id || row.addresseeId === user.id
    if (!isInvolved) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    if (action === "accept") {
      if (row.addresseeId !== user.id || row.status !== "pending") {
        return NextResponse.json({ error: "Cannot accept this request" }, { status: 400 })
      }
      try {
        await db.update(friendships).set({ status: "accepted" }).where(eq(friendships.id, friendshipId))
      } catch {
        return NextResponse.json({ error: "Failed to accept request" }, { status: 500 })
      }

      // Notify the original requester that their request was accepted (fire-and-forget)
      Promise.resolve().then(async () => {
        const requesterId = row.requesterId
        const [accepter] = await db
          .select({ displayName: users.displayName, username: users.username, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
        const accepterName = accepter?.displayName || accepter?.username || "Someone"

        const [prefs] = await db
          .select({ friendRequestNotifications: userNotificationPreferences.friendRequestNotifications })
          .from(userNotificationPreferences)
          .where(eq(userNotificationPreferences.userId, requesterId))
          .limit(1)

        if (prefs && prefs.friendRequestNotifications === false) return

        const [notif] = await db
          .insert(notifications)
          .values({
            userId: requesterId,
            type: "friend_request",
            title: `${accepterName} accepted your friend request`,
            body: "You can now message each other.",
            iconUrl: accepter?.avatarUrl ?? null,
          })
          .returning()
        if (notif) {
          await publishGatewayEvent({
            type: "notification.created",
            channelId: `user:${requesterId}`,
            actorId: user.id,
            data: toSnakeCase(notif),
          }, { route: "/api/friends" })
        }

        await sendPushToUser(requesterId, {
          title: "Friend Request Accepted",
          body: `${accepterName} accepted your friend request`,
          url: "/channels/me",
          tag: `friend-accepted-${user.id}`,
        })
      }).catch((err) => { console.error("friends PATCH: accept notification failed", { actorId: user.id, targetId: row.requesterId }, err) })

      return NextResponse.json({ message: "Friend request accepted" })
    }

    if (action === "decline") {
      if (row.addresseeId !== user.id || row.status !== "pending") {
        return NextResponse.json({ error: "Cannot decline this request" }, { status: 400 })
      }
      try {
        await db.delete(friendships).where(eq(friendships.id, friendshipId))
      } catch {
        return NextResponse.json({ error: "Failed to update friendship" }, { status: 500 })
      }
      return NextResponse.json({ message: "Friend request declined" })
    }

    if (action === "block") {
      // Blocker must be the current user — update requester_id/addressee_id so blocked is always addressee
      if (row.requesterId === user.id) {
        // Already requester, just flip status
        try {
          await db.update(friendships).set({ status: "blocked" }).where(eq(friendships.id, friendshipId))
        } catch {
          return NextResponse.json({ error: "Failed to update friendship" }, { status: 500 })
        }
      } else {
        // addressee is blocking the requester — need to swap direction so current user is requester
        try {
          await db
            .update(friendships)
            .set({ status: "blocked", requesterId: user.id, addresseeId: row.requesterId })
            .where(eq(friendships.id, friendshipId))
        } catch {
          return NextResponse.json({ error: "Failed to update friendship" }, { status: 500 })
        }
      }
      return NextResponse.json({ message: "User blocked" })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[friends PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/friends?id=<friendshipId>
// Unfriend or unblock
export async function DELETE(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { searchParams } = new URL(req.url)
    const friendshipId = searchParams.get("id")
    if (!friendshipId) return NextResponse.json({ error: "id required" }, { status: 400 })

    const [row] = await db
      .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
      .from(friendships)
      .where(eq(friendships.id, friendshipId))
      .limit(1)

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isInvolved = row.requesterId === user.id || row.addresseeId === user.id
    if (!isInvolved) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    try {
      await db.delete(friendships).where(eq(friendships.id, friendshipId))
    } catch {
      return NextResponse.json({ error: "Failed to remove friend" }, { status: 500 })
    }

    return NextResponse.json({ message: "Removed" })
  } catch (err) {
    console.error("[friends DELETE] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
