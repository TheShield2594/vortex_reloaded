import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { getAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"
import type { UserRow } from "@/types/database"
import { ProfileSettingsPage } from "@/components/settings/profile-settings-page"

export const metadata = { title: "Profile Settings — VortexChat" }

const db = createDb()

export default async function ProfileSettings() {
  const { data: { user }, error } = await getAuthUser()
  if (error || !user) redirect("/login")

  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  if (!row) redirect("/login")

  return <ProfileSettingsPage user={toSnakeCase<UserRow>(row)} />
}
