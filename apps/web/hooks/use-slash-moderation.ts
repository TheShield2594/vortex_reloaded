"use client"

import { useCallback } from "react"
import { hasPermission } from "@vortex/shared"
import type { MemberForMention } from "@/lib/stores/app-store"

interface UseSlashModerationOptions {
  serverId: string | undefined
  members: MemberForMention[]
  /** Computed permission bitmask for the current user */
  userPermissions: number
  /** Whether the current user is the server owner */
  isServerOwner: boolean
  /** Set the send-in-progress flag */
  setSending: (sending: boolean) => void
  /** Report an error message */
  setSendError: (error: string | null) => void
  /** Get and clear the current input content (returns the saved content for restore) */
  clearInput: () => string
  /** Restore content on failure */
  restoreInput: (content: string) => void
  /** Ref to the textarea for re-focus */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

interface UseSlashModerationReturn {
  /**
   * Attempt to handle a moderation slash command.
   * Returns `true` if the command was recognised and handled, `false` otherwise.
   */
  handleModeration: (commandName: string, args: string) => Promise<boolean>
}

export function useSlashModeration({
  serverId,
  members,
  userPermissions,
  isServerOwner,
  setSending,
  setSendError,
  clearInput,
  restoreInput,
  textareaRef,
}: UseSlashModerationOptions): UseSlashModerationReturn {
  const handleModeration = useCallback(async (commandName: string, args: string): Promise<boolean> => {
    if (!serverId) {
      setSendError("Moderation commands are only available inside a server.")
      return true
    }

    if (commandName === "kick") {
      if (!isServerOwner && !hasPermission(userPermissions, "KICK_MEMBERS")) {
        setSendError("You don't have permission to kick members.")
        return true
      }
      const targetUsername = args.split(/\s+/)[0]
      const reason = args.slice(targetUsername.length).trim()
      if (!targetUsername) { setSendError("Usage: /kick @username [reason]"); return true }
      const target = members.find((m) => m.username === targetUsername.replace(/^@/, ""))
      if (!target) { setSendError(`User "${targetUsername}" not found in this server.`); return true }
      setSending(true); setSendError(null)
      const savedContent = clearInput()
      try {
        const url = `/api/servers/${serverId}/members/${target.user_id}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`
        const res = await fetch(url, { method: "DELETE" })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p?.error ?? `Kick failed (${res.status})`) }
      } catch (error: unknown) {
        restoreInput(savedContent)
        setSendError(error instanceof Error ? error.message : "Failed to kick member.")
      } finally { setSending(false); textareaRef.current?.focus() }
      return true
    }

    if (commandName === "ban") {
      if (!isServerOwner && !hasPermission(userPermissions, "BAN_MEMBERS")) {
        setSendError("You don't have permission to ban members.")
        return true
      }
      const targetUsername = args.split(/\s+/)[0]
      const reason = args.slice(targetUsername.length).trim()
      if (!targetUsername) { setSendError("Usage: /ban @username [reason]"); return true }
      const target = members.find((m) => m.username === targetUsername.replace(/^@/, ""))
      if (!target) { setSendError(`User "${targetUsername}" not found in this server.`); return true }
      setSending(true); setSendError(null)
      const savedContent = clearInput()
      try {
        const res = await fetch(`/api/servers/${serverId}/bans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: target.user_id, reason: reason || undefined }),
        })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p?.error ?? `Ban failed (${res.status})`) }
      } catch (error: unknown) {
        restoreInput(savedContent)
        setSendError(error instanceof Error ? error.message : "Failed to ban member.")
      } finally { setSending(false); textareaRef.current?.focus() }
      return true
    }

    if (commandName === "unban") {
      if (!isServerOwner && !hasPermission(userPermissions, "BAN_MEMBERS")) {
        setSendError("You don't have permission to unban members.")
        return true
      }
      const targetInput = args.split(/\s+/)[0]
      if (!targetInput) { setSendError("Usage: /unban @username or /unban <userId>"); return true }
      setSending(true); setSendError(null)
      const savedContent = clearInput()
      try {
        // Banned users aren't in the members list, so resolve from the ban list
        const strippedName = targetInput.replace(/^@/, "")
        // If it looks like a UUID, use it directly; otherwise fetch the ban list
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        let targetUserId: string | null = uuidPattern.test(strippedName) ? strippedName : null
        if (!targetUserId) {
          const bansRes = await fetch(`/api/servers/${serverId}/bans`)
          if (!bansRes.ok) throw new Error("Failed to fetch ban list")
          const bans: Array<{ user_id: string; username?: string; display_name?: string; user?: { username?: string; display_name?: string } }> = await bansRes.json()
          const match = bans.find((b) => {
            const username = b.username ?? b.user?.username
            const displayName = b.display_name ?? b.user?.display_name
            return username === strippedName || displayName === strippedName || b.user_id === strippedName
          })
          if (!match) { throw new Error(`User "${targetInput}" not found in the ban list.`) }
          targetUserId = match.user_id
        }
        const res = await fetch(`/api/servers/${serverId}/bans?userId=${targetUserId}`, { method: "DELETE" })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p?.error ?? `Unban failed (${res.status})`) }
      } catch (error: unknown) {
        restoreInput(savedContent)
        setSendError(error instanceof Error ? error.message : "Failed to unban member.")
      } finally { setSending(false); textareaRef.current?.focus() }
      return true
    }

    if (commandName === "timeout") {
      if (!isServerOwner && !hasPermission(userPermissions, "MODERATE_MEMBERS")) {
        setSendError("You don't have permission to timeout members.")
        return true
      }
      // /timeout @username duration [reason]  — duration in minutes
      const parts = args.split(/\s+/)
      const targetUsername = parts[0]
      const durationStr = parts[1]
      const reason = parts.slice(2).join(" ")
      if (!targetUsername || !durationStr) { setSendError("Usage: /timeout @username <minutes> [reason]"); return true }
      if (!/^\d+$/.test(durationStr)) { setSendError("Duration must be a positive number of minutes."); return true }
      const durationMinutes = parseInt(durationStr, 10)
      if (isNaN(durationMinutes) || durationMinutes <= 0) { setSendError("Duration must be a positive number of minutes."); return true }
      const target = members.find((m) => m.username === targetUsername.replace(/^@/, ""))
      if (!target) { setSendError(`User "${targetUsername}" not found in this server.`); return true }
      setSending(true); setSendError(null)
      const savedContent = clearInput()
      try {
        const res = await fetch(`/api/servers/${serverId}/members/${target.user_id}/timeout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration_seconds: durationMinutes * 60, reason: reason || undefined }),
        })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p?.error ?? `Timeout failed (${res.status})`) }
      } catch (error: unknown) {
        restoreInput(savedContent)
        setSendError(error instanceof Error ? error.message : "Failed to timeout member.")
      } finally { setSending(false); textareaRef.current?.focus() }
      return true
    }

    if (commandName === "mute") {
      if (!isServerOwner && !hasPermission(userPermissions, "MUTE_MEMBERS")) {
        setSendError("You don't have permission to mute members.")
        return true
      }
      const targetUsername = args.split(/\s+/)[0]
      if (!targetUsername) { setSendError("Usage: /mute @username"); return true }
      const target = members.find((m) => m.username === targetUsername.replace(/^@/, ""))
      if (!target) { setSendError(`User "${targetUsername}" not found in this server.`); return true }
      // Mute uses the timeout endpoint with a short reason identifier
      setSending(true); setSendError(null)
      const savedContent = clearInput()
      try {
        const res = await fetch(`/api/servers/${serverId}/members/${target.user_id}/timeout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration_seconds: 600, reason: "Muted via /mute command" }),
        })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p?.error ?? `Mute failed (${res.status})`) }
      } catch (error: unknown) {
        restoreInput(savedContent)
        setSendError(error instanceof Error ? error.message : "Failed to mute member.")
      } finally { setSending(false); textareaRef.current?.focus() }
      return true
    }

    return false
  }, [serverId, members, userPermissions, isServerOwner, setSending, setSendError, clearInput, restoreInput, textareaRef])

  return { handleModeration }
}
