import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { getAuthUser } from "@/lib/auth/better-auth"
import { checkRateLimit } from "@/lib/utils/api-helpers"

const db = createDb()

/**
 * Persists the status the user picks in the UI (online / idle / dnd /
 * invisible / offline).
 *
 * This is a *preference*, not liveness: it survives across sessions so the
 * next connection starts out `dnd` or `invisible` again, and the client hands
 * it to the gateway as its initial status. Whether the user is actually
 * online is the gateway's Redis state alone — see lib/presence.ts (issue #57).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { data: { user }, error: authError } = await getAuthUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // A user toggling their status a few times in a row is normal, so this
    // ceiling is generous — it only stops abuse.
    const limited = await checkRateLimit(user.id, "presence:update", { limit: 60, windowMs: 60_000 })
    if (limited) return limited

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

    const now = new Date()
    const nowIso = now.toISOString()

    // For offline transitions, check if user was previously invisible (#608)
    // Invisible → offline must NOT update last_online_at to preserve privacy
    let setLastOnlineAt = false
    if (status === "offline") {
      const [currentProfile] = await db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)
      if (currentProfile?.status && currentProfile.status !== "invisible") {
        setLastOnlineAt = true
      }
    }

    let updatedUser: { id: string } | undefined
    try {
      const rows = await db
        .update(users)
        .set({
          status: status as "online" | "idle" | "dnd" | "invisible" | "offline",
          updatedAt: now,
          // Record last_online_at when transitioning to offline (#608)
          ...(setLastOnlineAt ? { lastOnlineAt: nowIso } : {}),
        })
        .where(eq(users.id, user.id))
        .returning({ id: users.id })
      updatedUser = rows[0]
    } catch (updateError) {
      console.error("presence: failed to update status", { route: "presence", userId: user.id, action: "update_status", error: updateError instanceof Error ? updateError.message : updateError })
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
