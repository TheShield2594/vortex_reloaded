import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { filterBlockedUserIds, getBlockedUserIdsForViewer } from "@/lib/social-block-policy"

// GET /api/friends/suggestions?q=alice&limit=8
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10) || 8, 1), 25)

    const { data: relationshipRows, error: relationshipError } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

    if (relationshipError) {
      return NextResponse.json({ error: "Failed to fetch suggestions" }, { status: 500 })
    }

    const blockedUserIds = await getBlockedUserIdsForViewer(supabase, user.id)

    const excluded = new Set<string>([user.id, ...blockedUserIds])
    for (const row of relationshipRows ?? []) {
      if (row.requester_id === user.id) excluded.add(row.addressee_id)
      if (row.addressee_id === user.id) excluded.add(row.requester_id)
    }

    let query = supabase
      .from("users")
      .select("id, username, display_name, avatar_url, status")
      .order("created_at", { ascending: false })
      .limit(100)

    if (q) {
      query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    }

    const { data: users, error } = await query
    if (error) return NextResponse.json({ error: "Failed to fetch friend suggestions" }, { status: 500 })

    const filtered = filterBlockedUserIds(users ?? [], (candidate) => candidate.id, blockedUserIds)
      .filter((candidate) => !excluded.has(candidate.id))
      .slice(0, limit)

    return NextResponse.json(filtered)

  } catch (err) {
    console.error("[friends/suggestions GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
