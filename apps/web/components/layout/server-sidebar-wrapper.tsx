"use client"

import { ServerSidebar } from "./server-sidebar"

// Always renders inline on both mobile and desktop.
// On mobile, ChannelsShell hides this component in full-screen channel views.
export function ServerSidebarWrapper() {
  return (
    <div className="flex flex-shrink-0">
      <ServerSidebar />
    </div>
  )
}
