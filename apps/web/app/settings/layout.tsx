import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"
import { createServerSupabaseClient, getAuthUser } from "@/lib/supabase/server"
import { SettingsResponsiveContent } from "@/components/settings/settings-responsive-content"
import { SettingsAppearanceProvider } from "@/components/settings/settings-appearance-provider"

/** Full-page settings layout — two-panel on desktop, stacked nav on mobile */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [supabase, { data: { user }, error }] = await Promise.all([
    createServerSupabaseClient(),
    getAuthUser(),
  ])

  if (error || !user) redirect("/login")

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single()

  if (profileError || !profile) redirect("/login")

  return (
    <SettingsAppearanceProvider>
      <div
        className="flex h-screen overflow-hidden"
        style={{
          background: "var(--theme-bg-primary)",
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <SettingsResponsiveContent user={profile}>
          {children}
        </SettingsResponsiveContent>
      </div>
    </SettingsAppearanceProvider>
  )
}
