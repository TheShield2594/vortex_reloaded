"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Link2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useConnectionsCallback } from "@/hooks/use-connections-callback"
import { authClient } from "@/lib/auth/auth-client"
import { useStepUpPrompt } from "@/components/settings/security/step-up-prompt"

const SOCIAL_PROVIDERS = [
  { id: "github" as const, label: "GitHub" },
  { id: "twitch" as const, label: "Twitch" },
  { id: "reddit" as const, label: "Reddit" },
]

type ConnectionRow = {
  id: string
  provider: string
  provider_user_id: string
  username: string | null
  display_name: string | null
  profile_url: string | null
  created_at: string
}

export function ConnectionsSection(): React.JSX.Element {
  const { toast } = useToast()
  const router = useRouter()
  const [connections, setConnections] = useState<ConnectionRow[]>([])
  const { requireStepUp, stepUpDialog } = useStepUpPrompt()

  const loadConnections = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/users/connections", { cache: "no-store" })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) setConnections(payload.connections ?? [])
    } catch {
      // Network error — leave connections unchanged
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  useConnectionsCallback(loadConnections, toast, router)

  async function connectSocial(provider: "github" | "twitch" | "reddit"): Promise<void> {
    // `/link-social` is step-up gated (lib/auth/better-auth.ts) — re-authenticate
    // before calling it, or Better Auth rejects it with a bare 403. A `false`
    // here means the user cancelled the prompt, so leave without a toast.
    if (!(await requireStepUp())) return
    try {
      const { data, error } = await authClient.linkSocial({
        provider,
        callbackURL: window.location.pathname + window.location.search,
      })
      if (error) {
        toast({ variant: "destructive", title: `Failed to connect ${provider}`, description: error.message })
        return
      }
      if (data?.url) window.location.href = data.url
    } catch (err: unknown) {
      toast({ variant: "destructive", title: `Failed to connect ${provider}`, description: err instanceof Error ? err.message : undefined })
    }
  }

  function connectSteam(): void {
    const next = window.location.pathname + window.location.search
    window.location.href = `/api/users/connections/steam/start?next=${encodeURIComponent(next)}`
  }

  function connectYouTube(): void {
    const next = window.location.pathname + window.location.search
    window.location.href = `/api/users/connections/youtube/start?next=${encodeURIComponent(next)}`
  }

  async function removeConnection(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/users/connections?id=${id}`, { method: "DELETE" })
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to remove connection" })
        return
      }
      setConnections((prev) => prev.filter((item) => item.id !== id))
    } catch {
      toast({ variant: "destructive", title: "Failed to remove connection" })
    }
  }

  const steamConnection = connections.find((item) => item.provider === "steam")
  const youtubeConnection = connections.find((item) => item.provider === "youtube")

  return (
    <div className="space-y-6">
      {SOCIAL_PROVIDERS.map(({ id, label }) => {
        const connection = connections.find((item) => item.provider === id)
        return (
          <div key={id} className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
            <h3 className="text-base font-semibold text-white">{label}</h3>
            {connection && (
              <p className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>
                Connected as {connection.display_name || connection.username || connection.provider_user_id}
              </p>
            )}
            <Button type="button" onClick={() => connectSocial(id)} style={{ background: "var(--theme-accent)" }}>
              <Link2 className="w-4 h-4 mr-2" /> {connection ? `Reconnect ${label}` : `Connect ${label}`}
            </Button>
          </div>
        )
      })}

      <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <h3 className="text-base font-semibold text-white">Steam</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Link your Steam account using official OpenID sign-in. We only store your Steam ID and profile URL.</p>
        {steamConnection && (
          <p className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>
            Connected as {steamConnection.display_name || steamConnection.username || steamConnection.provider_user_id}
          </p>
        )}
        <Button type="button" onClick={connectSteam} style={{ background: "var(--theme-accent)" }}>
          <Link2 className="w-4 h-4 mr-2" /> {steamConnection ? "Reconnect Steam" : "Connect Steam"}
        </Button>
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <h3 className="text-base font-semibold text-white">YouTube</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Sign in with Google to link your YouTube channel. We only read your channel name and stats.</p>
        {youtubeConnection && (
          <p className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>
            Connected as {youtubeConnection.display_name || youtubeConnection.username || youtubeConnection.provider_user_id}
          </p>
        )}
        <Button type="button" onClick={connectYouTube} style={{ background: "var(--theme-accent)" }}>
          <Link2 className="w-4 h-4 mr-2" /> {youtubeConnection ? "Reconnect YouTube" : "Connect YouTube"}
        </Button>
      </div>

      <div className="space-y-2">
        {connections.map((connection) => (
          <div key={connection.id} className="rounded-lg p-3 flex items-center justify-between gap-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
            <div className="min-w-0">
              <p className="text-sm text-white capitalize">{connection.provider}</p>
              <p className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>{connection.display_name || connection.username || connection.provider_user_id}</p>
            </div>
            <div className="flex items-center gap-2">
              {connection.profile_url && (
                <a href={connection.profile_url} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)" }}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => removeConnection(connection.id)} style={{ color: "var(--theme-danger)" }}>Remove</Button>
            </div>
          </div>
        ))}
        {connections.length === 0 && <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>No connections yet.</p>}
      </div>

      {stepUpDialog}
    </div>
  )
}
