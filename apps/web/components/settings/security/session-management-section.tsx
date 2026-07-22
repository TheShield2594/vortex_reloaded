"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

interface AuthSessionRow {
  id: string
  created_at: string
  last_seen_at: string | null
  user_agent: string | null
  ip_address: string | null
  expires_at: string | null
  revoked_at: string | null
}

interface Props {
  onForcedLogout: () => Promise<void> | void
}

export function SessionManagementSection({ onForcedLogout }: Props): React.JSX.Element {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<AuthSessionRow[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/sessions")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load sessions")
        return res.json()
      })
      .then((payload) => {
        if (Array.isArray(payload.sessions)) {
          setSessions(payload.sessions)
          setSessionsError(null)
        } else {
          setSessionsError("Unexpected sessions payload")
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load sessions", error)
        setSessionsError(error instanceof Error ? error.message : "Failed to load sessions")
      })
  }, [])

  async function revokeSession(sessionId: string): Promise<void> {
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, { method: "DELETE" })
      if (res.ok) {
        setSessions((prev) => prev.map((session) => session.id === sessionId ? { ...session, revoked_at: new Date().toISOString() } : session))
        toast({ title: "Session revoked" })
      } else {
        const payload = await res.json().catch(() => ({}))
        toast({ variant: "destructive", title: "Failed to revoke session", description: payload.error || "Please try again" })
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to revoke session" })
    }
  }

  async function revokeAll(): Promise<void> {
    setLoading(true)
    try {
      const res = await fetch("/api/auth/sessions", { method: "DELETE" })
      if (res.ok) {
        toast({ title: "All sessions revoked", description: "Trusted devices and active sessions have been removed." })
        await onForcedLogout()
      } else {
        const payload = await res.json().catch(() => ({}))
        toast({ variant: "destructive", title: "Failed to revoke sessions", description: payload.error || "Please try again" })
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to revoke sessions" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Session Management</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Mark devices as trusted to reduce repeated prompts. If a device is lost, revoke all sessions immediately.</p>
      </div>
      <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Active sessions</p>
        {sessionsError && <p className="text-xs" style={{ color: "var(--theme-danger)" }}>{sessionsError}</p>}
        {sessions.map((session) => (
          <div key={session.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-white truncate">{session.user_agent || "Unknown device"}</p>
              <p className="text-[11px]" style={{ color: "var(--theme-text-muted)" }}>Last seen: {session.last_seen_at ? new Date(session.last_seen_at).toLocaleString() : "Unknown"}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={Boolean(session.revoked_at)} onClick={() => revokeSession(session.id)}>{session.revoked_at ? "Revoked" : "Revoke"}</Button>
          </div>
        ))}
      </div>
      <div className="rounded-lg p-4 space-y-3" style={{ background: "rgba(242,63,67,0.08)", border: "1px solid rgba(242,63,67,0.35)" }}>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>This action signs out all active sessions and removes trusted devices.</p>
        <Button variant="outline" onClick={revokeAll} disabled={loading} style={{ borderColor: "var(--theme-danger)", color: "var(--theme-danger)", background: "rgba(242,63,67,0.1)" }}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Revoke All Sessions
        </Button>
      </div>
    </div>
  )
}
