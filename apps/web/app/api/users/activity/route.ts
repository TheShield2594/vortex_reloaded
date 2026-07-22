import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/utils/api-helpers"

const FEED_LIMIT = 10

/**
 * GET /api/users/activity?userId={id}
 * Returns the recent activity feed for a user, respecting their activity_visibility setting:
 *   - public:  anyone (authenticated or not) can see it
 *   - friends: only accepted friends of the viewer can see it
 *   - private: only the user themselves can see it
 */
export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get("userId")

    if (!targetUserId) return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 })

    // Fetch the target user's visibility setting
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, activity_visibility")
      .eq("id", targetUserId)
      .single()

    if (userError || !targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const { data: { user: viewer } } = await supabase.auth.getUser()
    const viewerIsOwner = viewer?.id === targetUserId

    // Resolve visibility
    if (targetUser.activity_visibility === "private" && !viewerIsOwner) {
      return NextResponse.json({ activity: [], hidden: true })
    }

    if (targetUser.activity_visibility === "friends" && !viewerIsOwner) {
      if (!viewer) return NextResponse.json({ activity: [], hidden: true })
      // Check friendship
      const { data: friendship } = await supabase
        .from("friendships")
        .select("id")
        .eq("status", "accepted")
        .or(
          `and(requester_id.eq.${viewer.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${viewer.id})`
        )
        .maybeSingle()

      if (!friendship) return NextResponse.json({ activity: [], hidden: true })
    }

    const { data: activity, error: activityError } = await supabase
      .from("user_activity_log")
      .select("id, event_type, summary, ref_id, ref_type, ref_label, ref_url, created_at")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT)

    if (activityError) return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })

    return NextResponse.json({ activity: activity ?? [] })

  } catch (err) {
    console.error("[users/activity GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/users/activity — update activity_visibility setting for the authenticated user
 * Body: { visibility: "public" | "friends" | "private" }
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const body = await request.json().catch(() => null)
    const visibility = body?.visibility
    if (!["public", "friends", "private"].includes(visibility)) {
      return NextResponse.json({ error: "visibility must be one of: public, friends, private" }, { status: 422 })
    }

    const { data, error } = await supabase
      .from("users")
      .update({ activity_visibility: visibility, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select("id, activity_visibility")
      .single()

    if (error) return NextResponse.json({ error: "Failed to update activity visibility" }, { status: 500 })
    return NextResponse.json(data)

  } catch (err) {
    console.error("[users/activity PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
