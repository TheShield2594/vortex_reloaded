"use client"

import { useCallback, useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Users, Compass, X } from "lucide-react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { BrandedEmptyState } from "@/components/ui/branded-empty-state"
import { CreateServerModal } from "@/components/modals/create-server-modal"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils/cn"
import { perfMarkNavStart } from "@/lib/perf"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import type { PublicServer, DiscoverServersResponse } from "@vortex/shared"

/* ─── Constants ─── */
const RECENT_SERVERS_KEY = "vortexchat:recent-servers"
const MAX_RECENTS = 6

/* ─── Helpers ─── */

/** Read the ordered list of recently-visited server IDs from localStorage. */
function getRecentServerIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SERVERS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

/** Push a server to the front of the recents list (deduped). */
function touchRecentServer(serverId: string): void {
  try {
    const ids = getRecentServerIds().filter((id) => id !== serverId)
    ids.unshift(serverId)
    localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)))
  } catch { /* localStorage unavailable */ }
}

/* ─── Page ─── */
export default function ServersPage(): React.ReactElement {
  const { servers, isLoadingServers, channels, setActiveServer, serverHasUnread } = useAppStore(
    useShallow((s) => ({
      servers: s.servers,
      isLoadingServers: s.isLoadingServers,
      channels: s.channels,
      setActiveServer: s.setActiveServer,
      serverHasUnread: s.serverHasUnread,
    }))
  )
  const router = useRouter()
  const isMobile = useMobileLayout()

  // ── Local state ──
  const [showCreate, setShowCreate] = useState(false)
  const [segment, setSegment] = useState<"my-servers" | "discover">("my-servers")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Discover state ──
  const [discoverServers, setDiscoverServers] = useState<PublicServer[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverCursor, setDiscoverCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const discoverCursorRef = useRef(discoverCursor)
  const loadingMoreRef = useRef(loadingMore)
  discoverCursorRef.current = discoverCursor
  loadingMoreRef.current = loadingMore

  // ── Recent servers ──
  const [recentIds, setRecentIds] = useState<string[]>([])
  useEffect(() => {
    setRecentIds(getRecentServerIds())
  }, [])

  // ── Auto-switch to Discover when user has no servers ──
  useEffect(() => {
    if (!isLoadingServers && servers.length === 0) {
      setSegment("discover")
    }
  }, [isLoadingServers, servers.length])

  // ── Fetch discover servers ──
  const fetchDiscover = useCallback(
    async (q?: string, cursor?: string): Promise<DiscoverServersResponse> => {
      try {
        const params = new URLSearchParams()
        if (q) params.set("q", q)
        if (cursor) params.set("cursor", cursor)
        const res = await fetch(`/api/servers/discover?${params.toString()}`)
        if (!res.ok) {
          console.error("Discover API error", { status: res.status, q, cursor })
          throw new Error(`Discover API error ${res.status}`)
        }
        const body: unknown = await res.json()
        if (
          !body ||
          typeof body !== "object" ||
          !("servers" in body) ||
          !Array.isArray((body as { servers: unknown }).servers)
        ) {
          throw new Error("Invalid discover response shape")
        }
        return body as DiscoverServersResponse
      } catch (err) {
        console.error("fetchDiscover failed", { q, cursor, err })
        throw err
      }
    },
    []
  )

  // Debounced discover fetch
  useEffect(() => {
    if (segment !== "discover") return
    const trimmed = searchQuery.trim()
    let cancelled = false
    // Reset pagination immediately so the infinite-scroll observer can't
    // fire with a stale cursor during the debounce window.
    setDiscoverCursor(null)
    discoverCursorRef.current = null
    setLoadingMore(false)
    loadingMoreRef.current = false
    setDiscoverError(null)
    const timer = setTimeout(
      async () => {
        setDiscoverLoading(true)
        try {
          const result = await fetchDiscover(trimmed || undefined)
          if (!cancelled) {
            setDiscoverServers(result.servers)
            setDiscoverCursor(result.nextCursor)
            setDiscoverError(null)
          }
        } catch (err) {
          if (!cancelled) {
            console.error("Failed to fetch discover servers:", err)
            setDiscoverError(err instanceof Error ? err.message : "Failed to load servers")
          }
        } finally {
          if (!cancelled) setDiscoverLoading(false)
        }
      },
      trimmed ? 300 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [segment, searchQuery, fetchDiscover])

  // Infinite scroll for discover
  useEffect(() => {
    if (segment !== "discover" || !discoverCursor) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const trimmed = searchQuery.trim()
    let cancelled = false

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        const cur = discoverCursorRef.current
        if (entry.isIntersecting && cur && !loadingMoreRef.current) {
          loadingMoreRef.current = true
          setLoadingMore(true)
          fetchDiscover(trimmed || undefined, cur)
            .then((result) => {
              if (!cancelled) {
                setDiscoverServers((prev) => [...prev, ...result.servers])
                setDiscoverCursor(result.nextCursor)
              }
            })
            .catch((err) => {
              if (!cancelled) console.error("Failed to load more servers:", err)
            })
            .finally(() => {
              loadingMoreRef.current = false
              if (!cancelled) setLoadingMore(false)
            })
        }
      },
      { rootMargin: "200px" }
    )

    observer.observe(sentinel)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [segment, discoverCursor, searchQuery, fetchDiscover])

  // ── Navigation ──
  const navigateToServer = useCallback(
    (serverId: string) => {
      perfMarkNavStart(`server:${serverId.slice(0, 8)}`)
      setActiveServer(serverId)
      touchRecentServer(serverId)
      setRecentIds(getRecentServerIds())

      if (isMobile) {
        router.push(`/channels/${serverId}`)
        return
      }

      try {
        const stored = localStorage.getItem(`vortexchat:last-channel:${serverId}`)
        if (stored) {
          const cached = channels[serverId]
          if (!cached || cached.some((c) => c.id === stored)) {
            router.push(`/channels/${serverId}/${stored}`)
            return
          }
        }
      } catch { /* ignore */ }

      const cached = channels[serverId]
      if (cached && cached.length > 0) {
        const firstText = [...cached]
          .filter((c) => c.type === "text")
          .sort((a, b) => a.position - b.position)[0]
        if (firstText) {
          router.push(`/channels/${serverId}/${firstText.id}`)
          return
        }
      }

      router.push(`/channels/${serverId}`)
    },
    [channels, isMobile, router, setActiveServer]
  )

  async function joinServer(inviteCode: string): Promise<void> {
    try {
      const res = await fetch(`/api/invites/${inviteCode}`, { method: "POST" })
      if (res.ok) {
        const { server_id } = await res.json()
        navigateToServer(server_id)
      } else {
        const body = await res.json().catch(() => null)
        toast({
          variant: "destructive",
          title: "Failed to join server",
          description: body?.error || `Something went wrong (${res.status})`,
        })
      }
    } catch (err) {
      console.error("Join server error:", err)
      toast({
        variant: "destructive",
        title: "Failed to join server",
        description: "A network error occurred. Please try again.",
      })
    }
  }

  // Normalize search to avoid whitespace-only vs empty inconsistency
  const normalizedQuery = searchQuery.trim()

  // ── Filtered "My Servers" list ──
  const filteredServers = normalizedQuery
    ? servers.filter((s) => s.name.toLowerCase().includes(normalizedQuery.toLowerCase()))
    : servers

  // ── Recent servers resolved against current server list ──
  const recentServers = recentIds
    .map((id) => servers.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s != null)

  // Show recents only when on "my-servers", not searching, and have > 1 server
  const showRecents = segment === "my-servers" && !normalizedQuery && recentServers.length > 1

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--theme-bg-primary)" }}>
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--theme-bg-tertiary)" }}
      >
        <span className="font-semibold text-lg" style={{ color: "var(--theme-text-primary)" }}>
          Servers
        </span>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/15"
          style={{ color: "var(--theme-accent)" }}
          aria-label="Create server"
        >
          <Plus className="w-5 h-5" strokeWidth={2.2} />
        </button>
      </div>

      {/* ── Search bar ── */}
      <div className="px-3 pt-3 pb-1 flex-shrink-0">
        <div
          className="relative flex items-center rounded-xl h-10 px-3 gap-2 transition-colors"
          style={{
            background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)",
            border: searchFocused
              ? "1px solid color-mix(in srgb, var(--theme-accent) 50%, transparent)"
              : "1px solid transparent",
          }}
        >
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
          <input
            ref={searchRef}
            type="text"
            inputMode="search"
            aria-label={segment === "my-servers" ? "Search my servers" : "Search public servers"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={segment === "my-servers" ? "Search my servers…" : "Search public servers…"}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--theme-text-muted)]"
            style={{ color: "var(--theme-text-primary)" }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("")
                searchRef.current?.focus()
              }}
              className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-white/10"
              style={{ color: "var(--theme-text-muted)" }}
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Segmented control ── */}
      <div className="px-3 pt-2 pb-1 flex-shrink-0">
        <div
          className="flex rounded-xl p-1 gap-1"
          role="group"
          aria-label="Server sections"
          style={{
            background: "color-mix(in srgb, var(--theme-bg-tertiary) 50%, transparent)",
          }}
        >
          {([
            { id: "my-servers" as const, label: "My Servers" },
            { id: "discover" as const, label: "Discover", icon: Compass },
          ]).map(({ id, label, icon: Icon }) => {
            const active = segment === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSegment(id)
                  setSearchQuery("")
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                  "motion-safe:duration-200",
                )}
                style={{
                  background: active
                    ? "color-mix(in srgb, var(--theme-accent) 14%, var(--theme-bg-secondary))"
                    : "transparent",
                  color: active ? "var(--theme-accent)" : "var(--theme-text-secondary)",
                  boxShadow: active
                    ? "0 1px 3px color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)"
                    : "none",
                }}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto" aria-label={segment === "my-servers" ? "My Servers" : "Discover"}>
        {segment === "my-servers" ? (
          <div className="px-3 py-2">
            {/* Loading skeleton */}
            {isLoadingServers && servers.length === 0 && (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!isLoadingServers && servers.length === 0 && (
              <div className="px-2 py-8">
                <BrandedEmptyState
                  icon={Users}
                  title="No servers yet"
                  description="Join a community or start your own."
                  hint="Create a server or discover public ones below."
                />
                <div className="flex items-center justify-center gap-3 mt-5">
                  <Button
                    onClick={() => setShowCreate(true)}
                    className="rounded-xl"
                    style={{ background: "var(--theme-accent)", color: "white" }}
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Create Server
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSegment("discover")
                      setSearchQuery("")
                    }}
                    className="rounded-xl"
                    style={{
                      borderColor: "color-mix(in srgb, var(--theme-text-primary) 12%, transparent)",
                      color: "var(--theme-text-secondary)",
                    }}
                  >
                    <Compass className="w-4 h-4 mr-1.5" />
                    Discover
                  </Button>
                </div>
              </div>
            )}

            {/* Recent servers horizontal row */}
            {showRecents && (
              <div className="mb-3">
                <span
                  className="text-xs font-medium uppercase tracking-wider px-1 mb-2 block"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  Recent
                </span>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {recentServers.map((server) => {
                    const initials = server.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()
                    const hasUnread = serverHasUnread[server.id] ?? false

                    return (
                      <button
                        type="button"
                        key={server.id}
                        onClick={() => navigateToServer(server.id)}
                        className="flex flex-col items-center gap-1.5 min-w-[64px] max-w-[72px] py-1.5 rounded-xl transition-colors hover:bg-white/5 active:bg-white/10"
                      >
                        <div className="relative">
                          <Avatar className="w-11 h-11 rounded-2xl">
                            {server.icon_url && <AvatarImage src={server.icon_url} />}
                            <AvatarFallback
                              className="rounded-2xl text-[11px] font-bold"
                              style={{ background: "var(--theme-accent)", color: "white" }}
                            >
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          {hasUnread && (
                            <span
                              aria-hidden="true"
                              className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                              style={{ background: "var(--theme-danger)", borderColor: "var(--theme-bg-primary)" }}
                            />
                          )}
                        </div>
                        <span
                          className="text-[10px] leading-tight text-center truncate w-full"
                          style={{ color: hasUnread ? "var(--theme-text-primary)" : "var(--theme-text-muted)" }}
                        >
                          {server.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Search results info */}
            {normalizedQuery && (
              <span
                className="text-xs px-1 mb-2 block"
                style={{ color: "var(--theme-text-muted)" }}
              >
                {filteredServers.length} result{filteredServers.length !== 1 ? "s" : ""}
              </span>
            )}

            {/* All servers header (only when there are recents) */}
            {showRecents && (
              <span
                className="text-xs font-medium uppercase tracking-wider px-1 mb-2 block"
                style={{ color: "var(--theme-text-muted)" }}
              >
                All Servers
              </span>
            )}

            {/* Server list */}
            <div className="space-y-0.5">
              {filteredServers.map((server) => {
                const initials = server.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()
                const hasUnread = serverHasUnread[server.id] ?? false

                return (
                  <button
                    type="button"
                    key={server.id}
                    onClick={() => navigateToServer(server.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors",
                      "hover:bg-white/5 active:bg-white/10"
                    )}
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar className="w-10 h-10 rounded-2xl">
                        {server.icon_url && <AvatarImage src={server.icon_url} />}
                        <AvatarFallback
                          className="rounded-2xl text-xs font-bold"
                          style={{ background: "var(--theme-accent)", color: "white" }}
                        >
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      {hasUnread && (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                          style={{ background: "var(--theme-accent)", borderColor: "var(--theme-bg-primary)" }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span
                        className={cn("text-sm truncate block", hasUnread ? "font-semibold" : "")}
                        style={{ color: hasUnread ? "var(--theme-text-primary)" : "var(--theme-text-secondary)" }}
                      >
                        {server.name}
                      </span>
                      {hasUnread && <span className="sr-only">, unread</span>}
                      {server.description && (
                        <span className="text-xs truncate block" style={{ color: "var(--theme-text-muted)" }}>
                          {server.description}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* No search results */}
            {normalizedQuery && filteredServers.length === 0 && servers.length > 0 && (
              <div className="text-center py-8">
                <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
                  No servers matching &ldquo;{normalizedQuery}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSegment("discover")
                  }}
                  className="mt-2 text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: "var(--theme-accent)" }}
                >
                  Search public servers instead →
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── Discover segment ── */
          <div className="px-3 py-2">
            {discoverLoading && discoverServers.length === 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl p-3" style={{ background: "var(--theme-bg-secondary)" }}>
                    <Skeleton className="h-12 w-12 rounded-2xl mb-3" />
                    <Skeleton className="h-4 w-2/3 mb-2" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : discoverError ? (
              <div className="py-8 text-center">
                <Compass className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--theme-text-muted)" }} />
                <p className="text-sm font-medium mb-1" style={{ color: "var(--theme-text-primary)" }}>
                  Something went wrong
                </p>
                <p className="text-xs mb-4" style={{ color: "var(--theme-text-muted)" }}>
                  {discoverError}
                </p>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    setDiscoverError(null)
                    setDiscoverServers([])
                    setDiscoverCursor(null)
                    // Re-trigger the effect by toggling segment
                    setSegment("my-servers")
                    requestAnimationFrame(() => setSegment("discover"))
                  }}
                  style={{
                    borderColor: "color-mix(in srgb, var(--theme-text-primary) 12%, transparent)",
                    color: "var(--theme-text-secondary)",
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : discoverServers.length === 0 ? (
              <div className="py-8">
                <BrandedEmptyState
                  icon={Compass}
                  title="No servers found"
                  description={
                    normalizedQuery
                      ? "No public communities match your search."
                      : "No public communities to discover yet."
                  }
                  hint={
                    normalizedQuery
                      ? "Try a different search term."
                      : "Be the first — create a server and make it public!"
                  }
                />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {discoverServers.map((server) => (
                    <DiscoverServerCard
                      key={server.id}
                      server={server}
                      onJoin={() => joinServer(server.invite_code)}
                    />
                  ))}
                </div>

                {/* Infinite scroll sentinel */}
                <div ref={sentinelRef} className="flex justify-center py-4">
                  {loadingMore && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-muted)" }}>
                      <div
                        className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                        style={{ borderColor: "var(--theme-text-muted)", borderTopColor: "transparent" }}
                      />
                      Loading more…
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <CreateServerModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}

/* ─── Discover server card (extracted to avoid hooks-in-map violation) ─── */
function DiscoverServerCard({ server, onJoin }: { server: PublicServer; onJoin: () => void }): React.ReactElement {
  const [iconFailed, setIconFailed] = useState(false)
  const initials = server.name.slice(0, 2).toUpperCase()

  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-white/5"
      style={{ background: "var(--theme-bg-secondary)" }}
    >
      <div
        className="flex-shrink-0 w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center"
        style={{ background: "var(--theme-accent)" }}
      >
        {server.icon_url && !iconFailed ? (
          <img
            src={server.icon_url}
            alt={server.name}
            className="h-full w-full object-cover"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <span className="text-sm font-bold text-white">{initials}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className="text-sm font-semibold truncate block"
          style={{ color: "var(--theme-text-primary)" }}
        >
          {server.name}
        </span>
        {server.description && (
          <span
            className="text-xs line-clamp-1 block"
            style={{ color: "var(--theme-text-muted)" }}
          >
            {server.description}
          </span>
        )}
        <div className="flex items-center gap-1 mt-0.5">
          <Users className="w-3 h-3" style={{ color: "var(--theme-text-muted)" }} />
          <span className="text-[11px]" style={{ color: "var(--theme-text-muted)" }}>
            {server.member_count.toLocaleString()}
          </span>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-lg px-4 text-xs font-semibold flex-shrink-0"
        style={{ background: "var(--theme-accent)", color: "white" }}
        onClick={onJoin}
      >
        Join
      </Button>
    </div>
  )
}
