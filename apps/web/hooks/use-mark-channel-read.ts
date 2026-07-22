"use client"

import { useEffect, useMemo, useRef } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { markChannelReadRpc } from "@/lib/mark-channel-read"

/**
 * Marks a channel as read in the database when the user views it.
 *
 * Calls mark_channel_read RPC:
 *   - 500ms after mounting (debounce for rapid channel switching)
 *   - On unmount / channel change (flush so last_read_at reflects departure time)
 *
 * This hook lives in ChatArea (the component mounted while the user is reading)
 * rather than in the sidebar, so it works correctly on mobile where the sidebar
 * may unmount when viewing channel content.
 */
export function useMarkChannelRead(channelId: string): void {
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Debounce initial mark-read to avoid RPC spam on rapid channel switching
    timerRef.current = setTimeout(() => {
      void markChannelReadRpc(supabase, channelId, "debounce")
      timerRef.current = null
    }, 500)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // Flush on departure so last_read_at covers all messages the user saw
      void markChannelReadRpc(supabase, channelId, "cleanup")
    }
  }, [channelId, supabase])
}
