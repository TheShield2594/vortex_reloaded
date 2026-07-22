import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isUserConnectionsTableMissing } from "@/lib/supabase/user-connections-errors"

/**
 * GET /api/users/connections/public?userId=<uuid>
 * Returns the public connections for a given user (visible on their profile panel).
 * Accessible to both authenticated and anonymous visitors.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId")

    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("user_connections")
      .select("id, provider, provider_user_id, username, display_name, profile_url, metadata, created_at")
      .eq("user_id", userId.trim())
      .order("created_at", { ascending: true })

    if (error) {
      if (isUserConnectionsTableMissing(error)) {
        return NextResponse.json({ connections: [] })
      }
      return NextResponse.json({ error: "Failed to load connections" }, { status: 500 })
    }

    return NextResponse.json({ connections: data ?? [] })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
