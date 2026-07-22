import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/auth/recovery-codes"
import { untypedFrom } from "@/lib/supabase/untyped-table"

/**
 * GET /api/auth/recovery-codes
 * Returns the count of remaining (unused) recovery codes for the authenticated user.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data, error } = await untypedFrom(supabase, "recovery_codes")
      .select("id,used_at,created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true })

    if (error) return NextResponse.json({ error: "Failed to fetch recovery codes" }, { status: 500 })

    const codes = data || []
    const total = codes.length
    const remaining = codes.filter((c: { used_at: string | null }) => !c.used_at).length

    return NextResponse.json({ total, remaining })

  } catch (err) {
    console.error("[auth/recovery-codes GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/auth/recovery-codes
 * Generates a new set of 10 recovery codes. Deletes any existing codes first.
 * Returns the plaintext codes — this is the ONLY time they are shown.
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const admin = await createServiceRoleClient()

    // Delete all existing recovery codes for this user
    const { error: deleteError } = await untypedFrom(admin, "recovery_codes").delete().eq("user_id", auth.user.id)
    if (deleteError) {
      return NextResponse.json({ error: "Failed to clear existing recovery codes" }, { status: 500 })
    }

    // Generate new codes
    const plaintextCodes = generateRecoveryCodes()

    // Hash and store each code
    const rows = await Promise.all(
      plaintextCodes.map(async (code) => ({
        user_id: auth.user!.id,
        code_hash: await hashRecoveryCode(code),
      }))
    )

    const { error } = await untypedFrom(admin, "recovery_codes").insert(rows)
    if (error) return NextResponse.json({ error: "Failed to generate recovery codes" }, { status: 500 })

    return NextResponse.json({ codes: plaintextCodes })

  } catch (err) {
    console.error("[auth/recovery-codes POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
