"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"

interface ServerPreview {
  id: string
  name: string
  icon_url: string | null
  description: string | null
  member_count: number | null
}

/** Invite deep-link page.
 *
 *  - Authenticated users: automatically accepts the invite and redirects to the server.
 *  - Unauthenticated users: shows a server preview and prompts them to log in.
 *    After login, the ?redirect=/invite/CODE param routes them back here to accept. */
export default function InvitePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [server, setServer] = useState<ServerPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const addServer = useAppStore((s) => s.addServer)

  // Check auth state and fetch server preview
  useEffect(() => {
    async function init() {
      const supabase = createClientSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      setIsAuthenticated(!!user)

      // Fetch server preview (public endpoint)
      const res = await fetch(`/api/invites/${code}`)
      if (!res.ok) {
        setError("This invite link is invalid or has expired.")
        return
      }
      const data = await res.json()
      setServer(data)

      // Auto-accept for authenticated users
      if (user) {
        await acceptInvite()
      }
    }

    async function acceptInvite() {
      setAccepting(true)
      const res = await fetch(`/api/invites/${code}`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? "Failed to join server.")
        setAccepting(false)
        return
      }
      const { server_id } = await res.json()
      router.replace(`/channels/${server_id}`)
    }

    init()
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
        <div className="text-center space-y-4 max-w-md px-6">
          <h1 className="text-xl font-bold" style={{ color: "var(--theme-text-primary)" }}>Invite Invalid</h1>
          <p style={{ color: "var(--theme-text-secondary)" }}>{error}</p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="px-4 py-2 rounded font-medium"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  if (!server || isAuthenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
        <div className="animate-pulse text-center" style={{ color: "var(--theme-text-muted)" }}>
          Loading invite...
        </div>
      </div>
    )
  }

  if (accepting) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
        <div className="text-center space-y-2" style={{ color: "var(--theme-text-secondary)" }}>
          <p>Joining <strong style={{ color: "var(--theme-text-primary)" }}>{server.name}</strong>...</p>
        </div>
      </div>
    )
  }

  // Unauthenticated — show server preview with login prompt
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
      <div className="max-w-sm w-full rounded-lg p-6 text-center space-y-4" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-surface-elevated)" }}>
        {server.icon_url ? (
          <img
            src={server.icon_url}
            alt={server.name}
            className="w-16 h-16 rounded-full mx-auto"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <div
            className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-2xl font-bold"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {server.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--theme-text-primary)" }}>{server.name}</h1>
          {server.description && (
            <p className="text-sm mt-1" style={{ color: "var(--theme-text-secondary)" }}>{server.description}</p>
          )}
          {server.member_count != null && (
            <p className="text-xs mt-2" style={{ color: "var(--theme-text-muted)" }}>
              {server.member_count} {server.member_count === 1 ? "member" : "members"}
            </p>
          )}
        </div>

        <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
          You&apos;ve been invited to join this server. Log in or create an account to continue.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => router.push(`/login?redirect=/invite/${code}`)}
            className="w-full px-4 py-2 rounded font-medium"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            Log In to Join
          </button>
          <button
            type="button"
            onClick={() => router.push(`/register?redirect=/invite/${code}`)}
            className="w-full px-4 py-2 rounded font-medium"
            style={{ background: "transparent", color: "var(--theme-accent)", border: "1px solid var(--theme-accent)" }}
          >
            Create Account
          </button>
        </div>
      </div>
    </div>
  )
}
