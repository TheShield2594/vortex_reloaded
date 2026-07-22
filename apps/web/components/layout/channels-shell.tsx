"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { ServerSidebarWrapper } from "./server-sidebar-wrapper"
import { setupMobileBackGuard } from "@/utils/mobile-navigation"
import { isFullScreenChannel } from "@/lib/utils/navigation"

export function ChannelsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isFullScreen = isFullScreenChannel(pathname)

  // Prevent Android hardware back from exiting the PWA
  useEffect(() => {
    return setupMobileBackGuard("/channels/me")
  }, [])

  return (
    // Reserve nav-pill height + gap + safe-area on mobile; omitted in full-screen channel view
    <div
      className="flex h-dvh overflow-hidden md:!pb-0"
      style={{
        background: "var(--app-bg-primary)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: isFullScreen ? "env(safe-area-inset-bottom)" : "var(--mobile-tabbar-reserve)",
      }}
    >
      {/* Guild rail: desktop only — mobile uses bottom tab bar */}
      <div className="hidden md:flex">
        <ServerSidebarWrapper />
      </div>
      <main id="main-content" className="flex flex-1 overflow-hidden min-w-0" data-main-content>
        {children}
      </main>
    </div>
  )
}
