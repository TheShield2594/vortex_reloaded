import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/better-auth"
import { InvitesSettingsPage } from "@/components/settings/invites/invites-settings-page"

export const metadata = { title: "Invites — VortexChat" }

export default async function InvitesSettings() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/login")

  return <InvitesSettingsPage />
}
