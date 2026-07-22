"use client"

import { useSelectedLayoutSegment } from "next/navigation"
import { DMList } from "./dm-list"
import { UserPanel } from "@/components/layout/user-panel"

function DMNavContent({ showUserPanel = true, onNavigate }: { showUserPanel?: boolean; onNavigate?: () => void }): React.ReactElement {
  return (
    <>
      <div className="flex-1 min-h-0">
        <DMList onNavigate={onNavigate} />
      </div>
      {showUserPanel && <UserPanel />}
    </>
  )
}

export function MeShell({ children }: { children: React.ReactNode }): React.ReactElement {
  // useSelectedLayoutSegment returns the channelId segment when on /channels/me/[channelId]
  const segment = useSelectedLayoutSegment()
  const isInConversation = !!segment

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Desktop: always show DM list sidebar */}
      <div className="hidden md:flex flex-shrink-0">
        <div
          className="w-60 flex flex-col overflow-hidden"
          style={{ background: "var(--app-bg-secondary)" }}
        >
          <DMNavContent />
        </div>
      </div>

      {/* Mobile: show DM list OR conversation, not both */}
      <div className="md:hidden flex flex-1 overflow-hidden">
        {isInConversation ? (
          <main id="main-content" className="flex flex-1 overflow-hidden min-w-0">
            {children}
          </main>
        ) : (
          <div
            className="flex flex-1 flex-col overflow-hidden"
            style={{ background: "var(--app-bg-secondary)" }}
          >
            <DMNavContent showUserPanel={false} />
          </div>
        )}
      </div>

      {/* Desktop: main content area */}
      <main id="main-content" className="hidden md:flex flex-1 overflow-hidden min-w-0">
        {children}
      </main>
    </div>
  )
}
