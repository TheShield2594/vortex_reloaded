import { NextRequest, NextResponse } from "next/server"
import { and, eq, or } from "drizzle-orm"
import { createDb, friendships } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

const db = createDb()

// GET /api/friends/status?userId=<id>
// Returns { status: "none" | "friends" | "pending_sent" | "pending_received" | "blocked", friendshipId?: string }
export async function GET(req: NextRequest) {
  try {
    const { data: { user } } = await getBetterAuthUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const targetUserId = searchParams.get("userId")
    if (!targetUserId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    if (targetUserId === user.id) {
      return NextResponse.json({ status: "self" })
    }

    let row: { id: string; status: string; requesterId: string; addresseeId: string } | undefined
    try {
      const rows = await db
        .select({
          id: friendships.id,
          status: friendships.status,
          requesterId: friendships.requesterId,
          addresseeId: friendships.addresseeId,
        })
        .from(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, targetUserId)),
            and(eq(friendships.requesterId, targetUserId), eq(friendships.addresseeId, user.id))
          )
        )
        .limit(1)
      row = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 })
    }

    if (!row) {
      return NextResponse.json({ status: "none" })
    }

    const isRequester = row.requesterId === user.id

    if (row.status === "accepted") {
      return NextResponse.json({ status: "friends", friendshipId: row.id })
    }
    if (row.status === "pending") {
      if (isRequester) {
        return NextResponse.json({ status: "pending_sent", friendshipId: row.id })
      }
      return NextResponse.json({ status: "pending_received", friendshipId: row.id })
    }
    if (row.status === "blocked") {
      return NextResponse.json({ status: "blocked", friendshipId: row.id })
    }

    return NextResponse.json({ status: "none" })

  } catch (err) {
    console.error("[friends/status GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
