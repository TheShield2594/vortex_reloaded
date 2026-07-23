import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

const db = createDb()

/**
 * POST /api/onboarding/complete
 *
 * Marks the authenticated user's onboarding as complete by setting
 * `onboarding_completed_at` to the current timestamp.
 */
export async function POST(): Promise<NextResponse> {
  let userId: string | undefined
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = user.id

    let updatedUser: { id: string } | undefined
    try {
      const rows = await db
        .update(users)
        .set({ onboardingCompletedAt: new Date().toISOString() })
        .where(eq(users.id, user.id))
        .returning({ id: users.id })
      updatedUser = rows[0]
    } catch (updateError) {
      console.error("Onboarding complete failed:", {
        route: "/api/onboarding/complete",
        action: "complete-onboarding",
        userId: user.id,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      })
      return NextResponse.json({ error: "Failed to update onboarding status" }, { status: 500 })
    }

    if (!updatedUser) {
      console.error("Onboarding complete failed:", {
        route: "/api/onboarding/complete",
        action: "complete-onboarding",
        userId: user.id,
        error: "No user row updated",
      })
      return NextResponse.json({ error: "Failed to update onboarding status" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("POST /api/onboarding/complete unexpected failure:", {
      route: "/api/onboarding/complete",
      action: "complete-onboarding",
      userId,
      error: error instanceof Error ? error.message : error,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
