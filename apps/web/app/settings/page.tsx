import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SettingsIndexRedirect } from "@/components/settings/settings-index-redirect"

/**
 * Settings index page.
 * Desktop: immediately redirects to /settings/profile.
 * Mobile: renders the settings sidebar (handled by the layout's SettingsMobileWrapper).
 */
export default async function SettingsPage() {
  // On desktop the mobile wrapper is hidden, so redirect server-side
  // to /settings/profile. Mobile users see the sidebar nav instead.
  // We cannot detect viewport on the server, so we render a client
  // component that handles the desktop redirect.
  return <SettingsIndexRedirect />
}
