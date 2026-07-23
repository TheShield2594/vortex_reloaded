import { redirect } from "next/navigation"
import { getAuthUser } from "@/lib/auth/better-auth"
import { NotificationsSettingsPage } from "@/components/settings/notifications-settings-page"

export const metadata = { title: "Notifications — VortexChat" }

export default async function NotificationsSettings() {
  const { data: { user }, error } = await getAuthUser()
  if (error || !user) redirect("/login")

  return <NotificationsSettingsPage userId={user.id} />
}
