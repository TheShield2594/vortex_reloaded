import { redirect } from "next/navigation"
import { createServerSupabaseClient, getAuthUser } from "@/lib/supabase/server"
import { SecuritySettingsPage } from "@/components/settings/security-settings-page"

export const metadata = { title: "Security & Privacy — VortexChat" }

export default async function SecuritySettings() {
  const [supabase, { data: { user }, error }] = await Promise.all([
    createServerSupabaseClient(),
    getAuthUser(),
  ])
  if (error || !user) redirect("/login")

  // Check MFA enrollment status
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const hasTOTP = factors?.totp?.some((f) => f.status === "verified") ?? false

  return <SecuritySettingsPage userId={user.id} hasTOTP={hasTOTP} userEmail={user.email ?? ""} />
}
