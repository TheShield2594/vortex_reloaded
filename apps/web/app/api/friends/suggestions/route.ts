import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, like, or } from "drizzle-orm"
import { createDb, friendships, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { filterBlockedUserIds } from "@/lib/social-block-policy"
import { toSnakeCase } from "@/lib/utils/case"

const db = createDb()

// GET /api/friends/suggestions?q=alice&limit=8
export async function GET(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10) || 8, 1), 25)

    let relationshipRows: { requesterId: string; addresseeId: string }[]
    try {
      relationshipRows = await db
        .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
        .from(friendships)
        .where(or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id)))
    } catch {
      return NextResponse.json({ error: "Failed to fetch suggestions" }, { status: 500 })
    }

    // Blocked-in-either-direction user ids. Inlined here (rather than the
    // shared getBlockedUserIdsForViewer helper in lib/social-block-policy.ts,
    // which still takes a supabase-js client) since this route no longer
    // holds one — same derivation as that helper's deriveBlockedUserIds.
    const blockedRows = await db
      .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "blocked"),
          or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id))
        )
      )

    const blockedUserIds = new Set<string>()
    for (const row of blockedRows) {
      if (row.requesterId === user.id) blockedUserIds.add(row.addresseeId)
      if (row.addresseeId === user.id) blockedUserIds.add(row.requesterId)
    }

    const excluded = new Set<string>([user.id, ...blockedUserIds])
    for (const row of relationshipRows) {
      if (row.requesterId === user.id) excluded.add(row.addresseeId)
      if (row.addresseeId === user.id) excluded.add(row.requesterId)
    }

    const searchConditions = q ? or(like(users.username, `%${q}%`), like(users.displayName, `%${q}%`)) : undefined

    let candidates: { id: string; username: string; displayName: string | null; avatarUrl: string | null; status: string }[]
    try {
      candidates = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          status: users.status,
        })
        .from(users)
        .where(searchConditions)
        .orderBy(desc(users.createdAt))
        .limit(100)
    } catch {
      return NextResponse.json({ error: "Failed to fetch friend suggestions" }, { status: 500 })
    }

    const filtered = filterBlockedUserIds(candidates, (candidate) => candidate.id, blockedUserIds)
      .filter((candidate) => !excluded.has(candidate.id))
      .slice(0, limit)

    return NextResponse.json(toSnakeCase(filtered))

  } catch (err) {
    console.error("[friends/suggestions GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
