"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { openDmChannel, sendFriendRequest } from "@/lib/social-actions"

type FriendshipStatus = "none" | "friends" | "pending_sent" | "pending_received" | "blocked" | "self"

const VALID_FRIENDSHIP_STATUSES: ReadonlySet<string> = new Set<FriendshipStatus>([
  "none", "friends", "pending_sent", "pending_received", "blocked", "self",
])

function isFriendshipResponse(payload: unknown): payload is { status: FriendshipStatus; friendshipId?: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const obj = payload as Record<string, unknown>
  if (typeof obj.status !== "string" || !VALID_FRIENDSHIP_STATUSES.has(obj.status)) return false
  if (obj.friendshipId !== undefined && typeof obj.friendshipId !== "string") return false
  return true
}

interface UseFriendshipActionsOptions {
  userId?: string
  username?: string
  currentUserId?: string
  /** When true, fetch friendship status immediately on mount. When false, call fetchStatus manually (e.g. on popover open). */
  fetchOnMount?: boolean
}

interface UseFriendshipActionsReturn {
  friendshipStatus: FriendshipStatus
  friendshipId: string | null
  actionLoading: "message" | "friend" | null
  isOtherUser: boolean
  handleMessage: () => Promise<void>
  handleAddFriend: () => Promise<void>
  handleRemoveFriend: () => Promise<void>
  fetchStatus: (forceRefresh?: boolean) => Promise<void>
}

/** Shared hook for friendship status fetching and friend/message actions used by ProfilePanel and UserProfilePopover. */
export function useFriendshipActions({
  userId,
  username,
  currentUserId,
  fetchOnMount = false,
}: UseFriendshipActionsOptions): UseFriendshipActionsReturn {
  const router = useRouter()
  const { toast } = useToast()
  const [friendshipStatus, setFriendshipStatus] = useState<FriendshipStatus>("none")
  const [friendshipId, setFriendshipId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<"message" | "friend" | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)

  const isOtherUser = Boolean(userId && currentUserId && userId !== currentUserId)

  const fetchStatus = useCallback(async (forceRefresh = false): Promise<void> => {
    if (!isOtherUser || !userId || (statusLoaded && !forceRefresh)) return
    try {
      const res = await fetch(`/api/friends/status?userId=${userId}`)
      if (res.ok) {
        const payload: unknown = await res.json()
        if (isFriendshipResponse(payload)) {
          setFriendshipStatus(payload.status)
          setFriendshipId(payload.friendshipId ?? null)
        } else {
          console.error("[fetch friendship status] Unexpected response shape for userId:", userId)
        }
      }
    } catch (err) {
      console.error("[fetch friendship status] Failed for userId:", userId, err)
    } finally {
      setStatusLoaded(true)
    }
  }, [userId, isOtherUser, statusLoaded])

  useEffect(() => {
    if (!fetchOnMount || !isOtherUser || !userId) return
    // Force-refresh on mount to bypass the statusLoaded guard
    fetchStatus(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount-relevant deps, not fetchStatus identity
  }, [userId, isOtherUser, fetchOnMount])

  const handleMessage = useCallback(async (): Promise<void> => {
    if (!userId || actionLoading) return
    setActionLoading("message")
    try {
      // openDmChannel handles its own toast on errors
      await openDmChannel(userId, router, toast)
    } catch (error) {
      console.error("Failed to open DM:", error)
    } finally {
      setActionLoading(null)
    }
  }, [userId, actionLoading, router, toast])

  const handleAddFriend = useCallback(async (): Promise<void> => {
    if (!username || actionLoading) return
    setActionLoading("friend")
    try {
      // sendFriendRequest handles its own toast feedback
      const success = await sendFriendRequest(username, toast)
      if (success) {
        setFriendshipStatus("pending_sent")
      }
    } catch (error) {
      console.error("Failed to send friend request:", error)
    } finally {
      setActionLoading(null)
    }
  }, [username, actionLoading, toast])

  const handleRemoveFriend = useCallback(async (): Promise<void> => {
    if (!friendshipId || actionLoading) return
    setActionLoading("friend")
    try {
      const res = await fetch(`/api/friends?id=${friendshipId}`, { method: "DELETE" })
      if (res.ok) {
        toast({ title: "Friend removed" })
        setFriendshipStatus("none")
        setFriendshipId(null)
        return
      }
      // Non-ok: try to extract error message from response body
      let errorMessage = "Failed to remove friend"
      try {
        const json = await res.json()
        if (json && typeof json.error === "string") {
          errorMessage = json.error
        }
      } catch {
        // Response was not valid JSON — use fallback
      }
      toast({ variant: "destructive", title: errorMessage })
    } catch (error) {
      console.error("Failed to remove friend:", error)
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Network error while removing friend",
      })
    } finally {
      setActionLoading(null)
    }
  }, [friendshipId, actionLoading, toast])

  return {
    friendshipStatus,
    friendshipId,
    actionLoading,
    isOtherUser,
    handleMessage,
    handleAddFriend,
    handleRemoveFriend,
    fetchStatus,
  }
}
