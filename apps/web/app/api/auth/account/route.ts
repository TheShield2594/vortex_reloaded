import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { hasValidStepUpToken } from "@/lib/auth/step-up"

export async function DELETE() {
  try {
    const supabase = await createServerSupabaseClient()
    const admin = await createServiceRoleClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    if (!(await hasValidStepUpToken(auth.user.id))) {
      return NextResponse.json({ error: "Step-up authentication required" }, { status: 403 })
    }

    const { error } = await admin.auth.admin.deleteUser(auth.user.id)
    if (error) return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })

    await supabase.auth.signOut({ scope: "global" })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[auth/account DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
