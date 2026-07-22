"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FriendsSidebar } from "@/components/dm/friends-sidebar"

export default function FriendsPage() {
  const router = useRouter()
  const [isMobile, setIsMobile] = useState<boolean | null>(null)

  useEffect(() => {
    // On mobile, redirect to the Messages tab with friends toggle
    if (window.innerWidth < 768) {
      setIsMobile(true)
      router.replace("/channels/me?tab=friends")
    } else {
      setIsMobile(false)
    }
  }, [router])

  if (isMobile === null || isMobile) return null

  return (
    <div className="flex flex-1 overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      <div className="w-full max-w-xl border-r" style={{ borderColor: "var(--theme-bg-tertiary)", background: "var(--theme-bg-secondary)" }}>
        <FriendsSidebar />
      </div>
      <div className="hidden md:flex flex-1 items-center justify-center text-sm" style={{ color: "var(--theme-text-muted)" }}>
        Select a friend to start chatting.
      </div>
    </div>
  )
}
