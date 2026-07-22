"use client"

/**
 * Mobile navigation — drawer removed in favour of bottom tab bar.
 * Desktop sidebar is rendered inline by ChannelsShell → ServerSidebarWrapper.
 *
 * The provider + hook remain exported so any code that previously depended on
 * them still compiles (they just no-op on mobile now).
 */

import { useState, createContext, useContext } from "react"

interface MobileNavCtx {
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
}

const MobileNavContext = createContext<MobileNavCtx>({
  sidebarOpen: false,
  setSidebarOpen: () => {},
})

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <MobileNavContext.Provider value={{ sidebarOpen, setSidebarOpen }}>
      {children}
    </MobileNavContext.Provider>
  )
}

export function useMobileNav(): MobileNavCtx {
  return useContext(MobileNavContext)
}
