import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { hasValidStepUpToken } from "@/lib/auth/step-up"

const MIN_PASSWORD_LENGTH = 12

/**
 * PATCH /api/auth/password
 * In-app password change. Requires current password verification + new password.
 * Optionally revokes all other sessions after the change.
 */
export async function PATCH(request: Request) {
  try {
  const supabase = await createServerSupabaseClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await hasValidStepUpToken(auth.user.id))) {
    return NextResponse.json({ error: "Step-up authentication required" }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string
    newPassword?: string
    revokeOtherSessions?: boolean
  }

  if (!body.currentPassword || !body.newPassword) {
    return NextResponse.json({ error: "Current password and new password are required" }, { status: 400 })
  }

  if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    )
  }

  if (body.currentPassword === body.newPassword) {
    return NextResponse.json({ error: "New password must be different from current password" }, { status: 400 })
  }

  // Verify current password by attempting sign-in
  const email = auth.user.email
  if (!email) {
    return NextResponse.json({ error: "Unable to verify identity — no email on account" }, { status: 400 })
  }

  const admin = await createServiceRoleClient()

  // Verify the current password by attempting signInWithPassword on a throwaway client
  const { createClient } = await import("@supabase/supabase-js")
  const tempClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { error: verifyError } = await tempClient.auth.signInWithPassword({
    email,
    password: body.currentPassword,
  })

  if (verifyError) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 })
  }

  // Sign out the temp client session immediately (best-effort)
  try {
    await tempClient.auth.signOut()
  } catch {
    // Non-critical — the temp session will expire on its own
  }

  // Update the password using the admin client
  const { error: updateError } = await admin.auth.admin.updateUserById(auth.user.id, {
    password: body.newPassword,
  })

  if (updateError) {
    return NextResponse.json({ error: "Failed to update password" }, { status: 500 })
  }

  // Optionally revoke all other sessions (keeps the current one active)
  if (body.revokeOtherSessions) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" })
    if (signOutError) {
      // Password was changed successfully but session revocation failed
      return NextResponse.json({ ok: true, warning: "Password changed but failed to revoke other sessions" })
    }
  }

  return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
