import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/supabase/server"

/**
 * Lightweight presence endpoint used by `navigator.sendBeacon()` on tab close
 * to persist the user's offline status to the database. This ensures the
 * `users.status` field is accurate for push notification eligibility checks.
 *
 * Also used for general presence status updates from the client.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { data: { user }, error: authError } = await getAuthUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    }

    const status = (body as { status?: unknown }).status
    const validStatuses = ["online", "idle", "dnd", "invisible", "offline"]
    if (typeof status !== "string" || !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()
    const now = new Date().toISOString()

    // For offline transitions, check if user was previously invisible (#608)
    // Invisible → offline must NOT update last_online_at to preserve privacy
    let setLastOnlineAt = false
    if (status === "offline") {
      const { data: currentProfile } = await supabase
        .from("users")
        .select("status")
        .eq("id", user.id)
        .maybeSingle()
      if (currentProfile?.status && currentProfile.status !== "invisible") {
        setLastOnlineAt = true
      }
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({
        status: status as "online" | "idle" | "dnd" | "invisible" | "offline",
        updated_at: now,
        // Preserve the last heartbeat on explicit offline writes so a late
        // sendBeacon from one tab can't clobber another tab's fresh heartbeat.
        ...(status === "offline" ? {} : { last_heartbeat_at: now }),
        // Record last_online_at when transitioning to offline (#608)
        ...(setLastOnlineAt ? { last_online_at: now } : {}),
      })
      .eq("id", user.id)
      .select("id")
      .maybeSingle()

    if (updateError) {
      console.error("presence: failed to update status", { route: "presence", userId: user.id, action: "update_status", error: updateError.message })
      return NextResponse.json({ error: "Failed to update status" }, { status: 500 })
    }
    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("presence: unexpected error", { route: "presence", action: "update_status", error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
