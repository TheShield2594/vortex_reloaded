import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient, getAuthUser } from "@/lib/supabase/server"
import {
  PRESENCE_HEARTBEAT_DEBOUNCE_MS,
  type UserStatus,
} from "@vortex/shared"

const VALID_STATUSES = new Set<UserStatus>(["online", "idle", "dnd", "invisible"])

/**
 * POST /api/presence/heartbeat
 *
 * Client-side heartbeat endpoint. Called every 30s by the presence hook.
 * Updates `last_heartbeat_at` and optionally `status` in the users table.
 *
 * Uses a conditional UPDATE with a WHERE clause so the debounce is atomic:
 * only writes when the heartbeat is stale OR the status has changed.
 * This prevents concurrent tabs from stampeding writes.
 *
 * A separate cron job (`/api/cron/presence-cleanup`) marks users with stale
 * heartbeats as offline, providing reliable server-side disconnect detection
 * even when the client crashes without calling sendBeacon.
 *
 * Request body: { status: UserStatus }
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
    if (typeof status !== "string" || !VALID_STATUSES.has(status as UserStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const debounceThreshold = new Date(now.getTime() - PRESENCE_HEARTBEAT_DEBOUNCE_MS).toISOString()
    const supabase = await createServerSupabaseClient()

    // Atomic conditional UPDATE: only writes when either the heartbeat is stale
    // (older than debounce threshold) OR the status has changed. This prevents
    // concurrent tabs from all writing when they observe the same stale value.
    //
    // The .or() filter ensures we only touch rows that actually need updating:
    // - last_heartbeat_at is null (first heartbeat / legacy user)
    // - last_heartbeat_at is older than the debounce window
    // - status differs from the desired status
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({
        last_heartbeat_at: nowIso,
        updated_at: nowIso,
        status: status as UserStatus,
      })
      .eq("id", user.id)
      .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${debounceThreshold},status.neq.${status}`)
      .select("id")
      .maybeSingle()

    if (updateError) {
      console.error("presence/heartbeat: failed to update", {
        route: "presence/heartbeat",
        userId: user.id,
        error: updateError.message,
      })
      return NextResponse.json({ error: "Failed to update heartbeat" }, { status: 500 })
    }

    // No row matched: either debounced (heartbeat recent + same status) or
    // user doesn't exist. Distinguish by checking if the user row exists.
    if (!updatedUser) {
      const { data: exists } = await supabase
        .from("users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle()

      if (!exists) {
        return NextResponse.json({ error: "User not found" }, { status: 404 })
      }

      // User exists but the conditional UPDATE didn't match → debounced
      return NextResponse.json({ ok: true, debounced: true })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("presence/heartbeat: unexpected error", {
      route: "presence/heartbeat",
      error: err,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
