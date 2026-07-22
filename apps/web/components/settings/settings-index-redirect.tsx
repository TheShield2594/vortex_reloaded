"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useMobileLayout } from "@/hooks/use-mobile-layout"

/**
 * On desktop, immediately redirect to /settings/profile.
 * On mobile, render nothing — the layout's SettingsMobileWrapper shows the sidebar.
 */
export function SettingsIndexRedirect() {
  const isMobile = useMobileLayout()
  const router = useRouter()

  useEffect(() => {
    if (!isMobile) {
      router.replace("/settings/profile")
    }
  }, [isMobile, router])

  // Mobile: render nothing — the SettingsMobileWrapper in the layout handles it.
  // Desktop: nothing visible while the redirect fires.
  return null
}
