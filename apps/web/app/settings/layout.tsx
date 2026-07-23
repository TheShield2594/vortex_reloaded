import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
import { createDb, users } from "@vortex/db"
import { getAuthUser } from "@/lib/supabase/server"
import { toSnakeCase } from "@/lib/utils/case"
import type { UserRow } from "@/types/database"
import { SettingsResponsiveContent } from "@/components/settings/settings-responsive-content"
import { SettingsAppearanceProvider } from "@/components/settings/settings-appearance-provider"

const db = createDb()

/** Full-page settings layout — two-panel on desktop, stacked nav on mobile */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { data: { user }, error } = await getAuthUser()

  if (error || !user) redirect("/login")

  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)

  if (!row) redirect("/login")
  const profile = toSnakeCase<UserRow>(row)

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
