"use client"

import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { SettingsSidebar } from "./settings-sidebar"
import type { UserRow } from "@/types/database"

interface Props {
  user: UserRow
  children: React.ReactNode
}

/** On mobile, shows the settings sidebar when at /settings root, or the content page with a back button otherwise. */
export function SettingsMobileWrapper({ user, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  // On /settings (the index), show the sidebar nav full-screen
  const isSettingsRoot = pathname === "/settings"

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {isSettingsRoot ? (
        <SettingsSidebar user={user} />
      ) : (
        <>
          {/* Mobile header with back arrow */}
          <div
            className="flex items-center gap-2 px-3 py-3 border-b flex-shrink-0"
            style={{
              background: "var(--theme-bg-secondary)",
              borderColor: "var(--theme-bg-tertiary)",
            }}
          >
            <button
              type="button"
              onClick={() => router.push("/settings")}
              className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15"
              style={{ color: "var(--theme-text-secondary)" }}
              aria-label="Back to settings"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--theme-text-primary)" }}
            >
              Settings
            </span>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-4 py-6">
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
