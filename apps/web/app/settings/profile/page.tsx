import { redirect } from "next/navigation"
import { createServerSupabaseClient, getAuthUser } from "@/lib/supabase/server"
import { ProfileSettingsPage } from "@/components/settings/profile-settings-page"

export const metadata = { title: "Profile Settings — VortexChat" }

export default async function ProfileSettings() {
  const [supabase, { data: { user }, error }] = await Promise.all([
    createServerSupabaseClient(),
    getAuthUser(),
  ])
  if (error || !user) redirect("/login")

  const { data: profile } = await supabase.from("users").select("*").eq("id", user.id).single()
  if (!profile) redirect("/login")

  return <ProfileSettingsPage user={profile} />
}
