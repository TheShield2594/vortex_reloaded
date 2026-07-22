"use client"

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { SteamIcon, YouTubeIcon } from "@/components/icons/social-icons"

interface ConnectionRow {
  id: string
  provider: string
  provider_user_id: string
  username: string | null
  display_name: string | null
  profile_url: string | null
  metadata: Record<string, unknown>
}

const PROVIDER_CONFIG: Record<string, { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string; color: string }> = {
  steam: { icon: SteamIcon, label: "Steam", color: "#171a21" },
  youtube: { icon: YouTubeIcon, label: "YouTube", color: "#FF0000" },
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return n.toLocaleString()
}

function getConnectionDetail(provider: string, meta: Record<string, unknown>): string | null {
  if (provider === "steam" && meta.game_count != null) {
    return `${Number(meta.game_count).toLocaleString()} games`
  }
  if (provider === "youtube") {
    const parts: string[] = []
    if (meta.subscriber_count != null) {
      parts.push(`${formatCount(Number(meta.subscriber_count))} subscribers`)
    }
    if (meta.video_count != null) {
      parts.push(`${formatCount(Number(meta.video_count))} videos`)
    }
    return parts.length > 0 ? parts.join(" · ") : null
  }
  return null
}

interface ProfileConnectionsProps {
  userId: string
}

export function ProfileConnections({ userId }: ProfileConnectionsProps): React.ReactElement | null {
  const [connections, setConnections] = useState<ConnectionRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setConnections([])
    setLoaded(false)

    async function load(): Promise<void> {
      try {
        const res = await fetch(
          `/api/users/connections/public?userId=${encodeURIComponent(userId)}`,
          { cache: "no-store", signal: controller.signal },
        )
        if (!res.ok) {
          console.error("Failed to load public connections", { status: res.status, userId })
          return
        }
        const payload = await res.json()
        if (!controller.signal.aborted) {
          setConnections(payload.connections ?? [])
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error("Error loading public connections", { userId, error: err instanceof Error ? err.message : String(err) })
      } finally {
        if (!controller.signal.aborted) {
          setLoaded(true)
        }
      }
    }

    load()
    return () => controller.abort()
  }, [userId])

  if (!loaded || connections.length === 0) return null

  return (
    <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
      <h4 className="text-[11px] font-semibold tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>CONNECTIONS</h4>
      <div className="space-y-2">
        {connections.map((connection) => {
          const config = PROVIDER_CONFIG[connection.provider]
          const Icon = config?.icon
          const meta = connection.metadata ?? {}
          const detail = getConnectionDetail(connection.provider, meta)

          return (
            <div
              key={connection.id}
              className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:[background:var(--theme-bg-tertiary)]"
              style={{ background: "rgba(0,0,0,0.15)" }}
            >
              {Icon && (
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-md shrink-0"
                  style={{ background: config.color }}
                >
                  <Icon className="w-4.5 h-4.5" style={{ color: "white" }} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: "var(--theme-text-normal)" }}>
                  {connection.display_name || connection.username || connection.provider_user_id}
                </p>
                <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  {config?.label ?? connection.provider}
                  {detail && ` · ${detail}`}
                </p>
              </div>
              {connection.profile_url && (
                <a
                  href={connection.profile_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 p-1.5 rounded-md transition-colors hover:[color:var(--theme-text-normal)] hover:[background:var(--theme-bg-tertiary)]"
                  style={{ color: "var(--theme-text-muted)" }}
                  aria-label={`Visit ${config?.label ?? connection.provider} profile`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
