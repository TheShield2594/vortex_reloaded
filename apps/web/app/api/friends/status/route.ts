import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

// GET /api/friends/status?userId=<id>
// Returns { status: "none" | "friends" | "pending_sent" | "pending_received" | "blocked", friendshipId?: string }
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const targetUserId = searchParams.get("userId")
    if (!targetUserId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    if (targetUserId === user.id) {
      return NextResponse.json({ status: "self" })
    }

    const { data: row, error } = await supabase
      .from("friendships")
      .select("id, status, requester_id, addressee_id")
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`
      )
      .maybeSingle()

    if (error) return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 })

    if (!row) {
      return NextResponse.json({ status: "none" })
    }

    const isRequester = row.requester_id === user.id

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
