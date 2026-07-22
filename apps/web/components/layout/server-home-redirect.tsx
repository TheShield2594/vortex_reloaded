"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useMobileLayout } from "@/hooks/use-mobile-layout"

interface Props {
  serverId: string
  channelId: string
}

/**
 * On desktop, immediately redirect to the first channel.
 * On mobile, render nothing — the ServerMobileLayout shows the channel sidebar.
 */
export function ServerHomeRedirect({ serverId, channelId }: Props) {
  const isMobile = useMobileLayout()
  const router = useRouter()

  useEffect(() => {
    if (!isMobile) {
      router.replace(`/channels/${serverId}/${channelId}`)
    }
  }, [isMobile, router, serverId, channelId])

  // Mobile: renders nothing; the channel sidebar fills the screen.
  // Desktop: nothing visible while the redirect fires.
  return null
}
