import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * GET /api/notifications/unread-count
 *
 * Returns the total unread notification count for the authenticated user.
 * Used by the service worker's periodic background sync to update the
 * PWA app badge (navigator.setAppBadge).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false)

    if (error) {
      return NextResponse.json({ error: "Failed to fetch unread count" }, { status: 500 })
    }

    return NextResponse.json({ count: count ?? 0 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
