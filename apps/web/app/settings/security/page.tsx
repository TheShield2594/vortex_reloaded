import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/better-auth"
import { SecuritySettingsPage } from "@/components/settings/security-settings-page"

export const metadata = { title: "Security & Privacy — VortexChat" }

export default async function SecuritySettings() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/login")

  return (
    <SecuritySettingsPage
      userId={session.user.id}
      hasTOTP={Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled)}
      userEmail={session.user.email ?? ""}
    />
  )
}
