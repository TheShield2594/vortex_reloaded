import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * POST /api/onboarding/complete
 *
 * Marks the authenticated user's onboarding as complete by setting
 * `onboarding_completed_at` to the current timestamp.
 */
export async function POST(): Promise<NextResponse> {
  let userId: string | undefined
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = user.id

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.id)
      .select("id")
      .single()

    if (updateError || !updatedUser) {
      console.error("Onboarding complete failed:", {
        route: "/api/onboarding/complete",
        action: "complete-onboarding",
        userId: user.id,
        error: updateError?.message ?? "No user row updated",
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
