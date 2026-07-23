"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { authClient } from "@/lib/auth/auth-client"

interface SessionRow {
  id: string
  token: string
  createdAt: string
  updatedAt: string
  userAgent?: string | null
  ipAddress?: string | null
}

interface Props {
  onForcedLogout: () => Promise<void> | void
}

export function SessionManagementSection({ onForcedLogout }: Props): React.JSX.Element {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [revokedTokens, setRevokedTokens] = useState<Set<string>>(new Set())
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  useEffect(() => {
    authClient.listSessions()
      .then((result) => {
        if (result.error) throw new Error(result.error.message)
        setSessions((result.data as unknown as SessionRow[]) ?? [])
        setSessionsError(null)
      })
      .catch((error: unknown) => {
        console.error("Failed to load sessions", error)
        setSessionsError(error instanceof Error ? error.message : "Failed to load sessions")
      })
  }, [])

  async function revokeSession(token: string): Promise<void> {
    try {
      const { error } = await authClient.revokeSession({ token })
      if (error) throw new Error(error.message)
      setRevokedTokens((prev) => new Set(prev).add(token))
      toast({ title: "Session revoked" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to revoke session", description: error instanceof Error ? error.message : "Please try again" })
    }
  }

  async function revokeAll(): Promise<void> {
    setLoading(true)
    try {
      const { error } = await authClient.revokeSessions()
      if (error) throw new Error(error.message)
      toast({ title: "All sessions revoked", description: "Every active session, including this one, has been signed out." })
      await onForcedLogout()
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to revoke sessions", description: error instanceof Error ? error.message : "Please try again" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Session Management</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>If a device is lost, revoke all sessions immediately.</p>
      </div>
      <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Active sessions</p>
        {sessionsError && <p className="text-xs" style={{ color: "var(--theme-danger)" }}>{sessionsError}</p>}
        {sessions.map((session) => {
          const revoked = revokedTokens.has(session.token)
          return (
            <div key={session.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-white truncate">{session.userAgent || "Unknown device"}</p>
                <p className="text-[11px]" style={{ color: "var(--theme-text-muted)" }}>Created: {session.createdAt ? new Date(session.createdAt).toLocaleString() : "Unknown"}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={revoked} onClick={() => revokeSession(session.token)}>{revoked ? "Revoked" : "Revoke"}</Button>
            </div>
          )
        })}
      </div>
      <div className="rounded-lg p-4 space-y-3" style={{ background: "rgba(242,63,67,0.08)", border: "1px solid rgba(242,63,67,0.35)" }}>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>This action signs out every active session, including this one.</p>
        <Button variant="outline" onClick={revokeAll} disabled={loading} style={{ borderColor: "var(--theme-danger)", color: "var(--theme-danger)", background: "rgba(242,63,67,0.1)" }}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Revoke All Sessions
        </Button>
      </div>
    </div>
  )
}
