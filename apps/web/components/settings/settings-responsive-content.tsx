"use client"

import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { SettingsSidebar } from "./settings-sidebar"
import { SettingsMobileWrapper } from "./settings-mobile-wrapper"
import type { UserRow } from "@/types/database"

interface Props {
  user: UserRow
  children: React.ReactNode
}

/**
 * Renders the settings sidebar + children in exactly one branch — desktop or
 * mobile — so components only mount once regardless of viewport.
 */
export function SettingsResponsiveContent({ user, children }: Props) {
  const isMobile = useMobileLayout()

  if (isMobile) {
    return (
      <SettingsMobileWrapper user={user}>
        {children}
      </SettingsMobileWrapper>
    )
  }

  return (
    <>
      <div className="flex flex-shrink-0">
        <SettingsSidebar user={user} />
      </div>
      <main
        id="settings-content"
        className="flex-1 overflow-y-auto"
        style={{ background: "var(--theme-bg-primary)" }}
      >
        <div className="max-w-2xl mx-auto px-8 py-10">
          {children}
        </div>
      </main>
    </>
  )
}
