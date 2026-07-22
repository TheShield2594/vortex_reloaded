"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Search, Users, Compass, BadgeCheck, Star, Plus, ArrowUpDown, ChevronDown, TrendingUp, Award, Sparkles, ShieldAlert, ShieldCheck } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { BrandedEmptyState } from "@/components/ui/branded-empty-state"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils/cn"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import {
  TRUST_BADGE_INFO,
  APP_PERMISSION_META,
  requiresInstallConfirmation,
} from "@vortex/shared"
import type { CuratedSection, PermissionImpactLevel } from "@vortex/shared"

interface PublicServer {
  id: string
  name: string
  description: string | null
  icon_url: string | null
  member_count: number
  invite_code: string
  created_at: string
}

interface DiscoverApp {
  id: string
  name: string
  description: string | null
  category: string
  trust_badge: "verified" | "partner" | "internal" | null
  average_rating: number
  review_count: number
  permissions: string[]
  icon_url?: string | null
}

const APP_CATEGORIES = ["all", "productivity", "ops", "community"]
const SORT_OPTIONS = [
  { value: "members", label: "Most Members" },
  { value: "newest", label: "Newest" },
] as const

type SortOption = (typeof SORT_OPTIONS)[number]["value"]

function trustBadgeColor(trustBadge: DiscoverApp["trust_badge"]): string {
  switch (trustBadge) {
    case "verified":
      return "text-emerald-400"
    case "partner":
      return "text-blue-400"
    case "internal":
      return "text-purple-400"
    default:
      return "text-muted-foreground"
  }
}

function trustBadgeLabel(trustBadge: DiscoverApp["trust_badge"]): string {
  switch (trustBadge) {
    case "verified":
      return "Verified"
    case "partner":
      return "Partner"
    case "internal":
      return "Official"
    default:
      return ""
  }
}

function curatedSectionIcon(slug: string): React.ReactNode {
  switch (slug) {
    case "featured":
      return <Sparkles className="h-5 w-5 text-amber-400" />
    case "trending":
      return <TrendingUp className="h-5 w-5 text-emerald-400" />
    case "staff-picks":
      return <Award className="h-5 w-5 text-blue-400" />
    default:
      return <Star className="h-5 w-5 text-muted-foreground" />
  }
}

const IMPACT_STYLES: Record<PermissionImpactLevel, { bg: string; text: string; label: string }> = {
  low: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Low" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Medium" },
  high: { bg: "bg-orange-500/10", text: "text-orange-400", label: "High" },
  critical: { bg: "bg-red-500/10", text: "text-red-400", label: "Critical" },
}

function TrustBadgeTooltip({ badge, className }: { badge: "verified" | "partner" | "internal"; className?: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const info = TRUST_BADGE_INFO[badge]
  const colorMap: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-400",
    purple: "border-purple-500/20 bg-purple-500/10 text-purple-400",
  }
  const iconColorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    blue: "text-blue-400",
    purple: "text-purple-400",
  }

  return (
    <div className={cn("relative inline-flex", className)}>
      <button
        type="button"
        className={cn("flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors", colorMap[info.color])}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`${info.label} trust badge: ${info.description}`}
      >
        <BadgeCheck className="h-3 w-3" />
        {info.label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-3 shadow-xl" role="tooltip">
          <div className="mb-1 flex items-center gap-1.5">
            <BadgeCheck className={cn("h-4 w-4", iconColorMap[info.color])} />
            <span className="text-sm font-semibold">{info.label}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{info.description}</p>
        </div>
      )}
    </div>
  )
}

function PermissionList({ permissions }: { permissions: string[] }): React.ReactElement {
  const grouped = { critical: [] as string[], high: [] as string[], medium: [] as string[], low: [] as string[] }
  for (const perm of permissions) {
    const meta = APP_PERMISSION_META[perm]
    const level = meta?.impact ?? "low"
    grouped[level].push(perm)
  }
  const order: PermissionImpactLevel[] = ["critical", "high", "medium", "low"]

  return (
    <div className="space-y-2">
      {order.map((level) => {
        const perms = grouped[level]
        if (perms.length === 0) return null
        const style = IMPACT_STYLES[level]
        return (
          <div key={level}>
            <div className="mb-1 flex items-center gap-1.5">
              {(level === "critical" || level === "high") ? (
                <ShieldAlert className={cn("h-3.5 w-3.5", style.text)} />
              ) : (
                <ShieldCheck className={cn("h-3.5 w-3.5", style.text)} />
              )}
              <span className={cn("text-[10px] font-semibold uppercase tracking-wider", style.text)}>{style.label} impact</span>
            </div>
            <div className="space-y-1">
              {perms.map((perm) => {
                const meta = APP_PERMISSION_META[perm]
                return (
                  <div key={perm} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 text-xs", style.bg)}>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{meta?.label ?? perm}</span>
                      {meta?.description && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{meta.description}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AppIcon({ name, iconUrl }: { name: string; iconUrl?: string | null }): React.ReactElement {
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    setImgFailed(false)
  }, [iconUrl])

  if (iconUrl && !imgFailed) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className="h-12 w-12 flex-shrink-0 rounded-xl object-cover shadow-sm"
        onError={() => setImgFailed(true)}
      />
    )
  }

  const colors = [
    "from-violet-500 to-purple-600",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-600",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-pink-600",
    "from-indigo-500 to-blue-600",
  ]
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length
  return (
    <div className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-lg font-bold text-white shadow-sm", colors[idx])}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function ServerIcon({ iconUrl, serverName }: { iconUrl: string | null; serverName: string }) {
  const [iconLoadFailed, setIconLoadFailed] = useState(false)

  useEffect(() => {
    setIconLoadFailed(false)
  }, [iconUrl])

  if (iconUrl && !iconLoadFailed) {
    return (
      <img
        src={iconUrl}
        alt={serverName}
        className="h-full w-full object-cover"
        onError={() => setIconLoadFailed(true)}
      />
    )
  }

  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
      {serverName.slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function DiscoverPage() {
  const [servers, setServers] = useState<PublicServer[]>([])
  const [apps, setApps] = useState<DiscoverApp[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [mode, setMode] = useState<"servers" | "apps">("servers")
  const [category, setCategory] = useState("all")
  const [sort, setSort] = useState<SortOption>("members")
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const router = useRouter()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const nextCursorRef = useRef(nextCursor)
  const loadingMoreRef = useRef(loadingMore)
  nextCursorRef.current = nextCursor
  loadingMoreRef.current = loadingMore

  // Curated sections for the Apps tab
  const [curatedSections, setCuratedSections] = useState<CuratedSection[]>([])

  // Server picker state for app installs
  const myServers = useAppStore(useShallow((s) => s.servers))
  const [pickerAppId, setPickerAppId] = useState<string | null>(null)
  const [installingTo, setInstallingTo] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Pre-install confirmation for elevated permissions
  const [confirmInstall, setConfirmInstall] = useState<{ appId: string; serverId: string; appName: string; permissions: string[] } | null>(null)

  // Close picker on outside click
  useEffect(() => {
    if (!pickerAppId) return
    function handleClick(e: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerAppId(null)
      }
    }
    document.addEventListener("pointerdown", handleClick)
    return () => document.removeEventListener("pointerdown", handleClick)
  }, [pickerAppId])

  function handleInstallClick(app: DiscoverApp, serverId: string): void {
    if (requiresInstallConfirmation(app.permissions)) {
      setPickerAppId(null)
      setConfirmInstall({ appId: app.id, serverId, appName: app.name, permissions: app.permissions })
    } else {
      installAppToServer(app.id, serverId)
    }
  }

  async function installAppToServer(appId: string, serverId: string) {
    setInstallingTo(serverId)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Install failed (${res.status})`)
      }
      toast({ title: "App installed successfully" })
      setPickerAppId(null)
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Install failed",
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setInstallingTo(null)
    }
  }

  const fetchServers = useCallback(async (q?: string, sortBy: SortOption = "members", cursor?: string) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (sortBy !== "members") params.set("sort", sortBy)
    if (cursor) params.set("cursor", cursor)
    const res = await fetch(`/api/servers/discover?${params.toString()}`)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Discover API error ${res.status}: ${body}`)
    }
    return (await res.json()) as { servers: PublicServer[]; nextCursor: string | null }
  }, [])

  const fetchApps = useCallback(async (q?: string, selectedCategory = "all"): Promise<DiscoverApp[]> => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (selectedCategory && selectedCategory !== "all") params.set("category", selectedCategory)
    const res = await fetch(`/api/apps/discover?${params.toString()}`)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Apps API error ${res.status}: ${body}`)
    }
    return await res.json()
  }, [])

  const fetchCurated = useCallback(async (): Promise<void> => {
    // Only fetch curated sections for the apps tab without an active search
    if (mode !== "apps" || query) {
      setCuratedSections([])
      return
    }
    try {
      const res = await fetch("/api/apps/curated")
      if (!res.ok) {
        setCuratedSections([])
        return
      }
      const data = await res.json()
      setCuratedSections(Array.isArray(data) ? data : [])
    } catch {
      setCuratedSections([])
    }
  }, [mode, query])

  const previousCategoryRef = useRef(category)
  const previousSortRef = useRef(sort)

  // Initial + filter/search fetch
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const categoryChanged = previousCategoryRef.current !== category
    const sortChanged = previousSortRef.current !== sort

    const execute = async () => {
      setLoading(true)
      try {
        const [serverResult, appResult] = await Promise.all([
          fetchServers(query || undefined, sort),
          fetchApps(query || undefined, category),
          fetchCurated(),
        ])
        if (!cancelled) {
          setServers(serverResult.servers)
          setNextCursor(serverResult.nextCursor)
          setApps(appResult)
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch discover data:", err)
          setServers([])
          setNextCursor(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    const debounceMs = query && !categoryChanged && !sortChanged ? 300 : 0
    if (debounceMs > 0) {
      timer = setTimeout(execute, debounceMs)
    } else {
      execute()
    }

    previousCategoryRef.current = category
    previousSortRef.current = sort

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [query, fetchServers, fetchApps, fetchCurated, category, sort])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (mode !== "servers" || !nextCursor) return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    let cancelled = false

    const observer = new IntersectionObserver(
      (entries) => {
        const cur = nextCursorRef.current
        if (entries[0].isIntersecting && cur && !loadingMoreRef.current) {
          setLoadingMore(true)
          fetchServers(query || undefined, sort, cur)
            .then((result) => {
              if (!cancelled) {
                setServers((prev) => [...prev, ...result.servers])
                setNextCursor(result.nextCursor)
              }
            })
            .catch((err) => {
              if (!cancelled) {
                console.error("Failed to load more servers:", err)
              }
            })
            .finally(() => {
              if (!cancelled) {
                setLoadingMore(false)
              }
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
  }, [mode, nextCursor, query, sort, fetchServers])

  async function joinServer(inviteCode: string) {
    try {
      const res = await fetch(`/api/invites/${inviteCode}`, { method: "POST" })
      if (res.ok) {
        const { serverId } = await res.json()
        router.push(`/channels/${serverId}`)
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Compass className="h-5 w-5 text-muted-foreground" />
        <span className="font-semibold">Discover</span>
      </div>

      <div className="bg-card px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">Find communities and apps</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Search servers, browse the app marketplace, and check trust badges and reviews.
        </p>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "servers" | "apps")}>
          <TabsList>
            <TabsTrigger value="servers">Servers</TabsTrigger>
            <TabsTrigger value="apps">Apps</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "servers" ? "Search servers…" : "Search apps…"}
              className="w-full rounded-lg border border-input bg-popover py-2.5 pl-9 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
          {mode === "servers" && (
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="rounded-lg border border-input bg-popover px-2 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {mode === "apps" && (
          <div className="mt-3 flex gap-2">
            {APP_CATEGORIES.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setCategory(item)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs capitalize",
                  category === item ? "bg-primary text-primary-foreground" : "bg-popover text-foreground"
                )}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="rounded-lg bg-card p-4">
                <Skeleton className="mb-3 h-20 w-full" />
                <Skeleton className="mb-2 h-4 w-2/3" />
                <Skeleton className="mb-3 h-3 w-full" />
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-14" />
                </div>
              </div>
            ))}
          </div>
        ) : mode === "servers" ? (
          servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <BrandedEmptyState
                icon={Compass}
                title="No servers found"
                description={query
                  ? "We couldn't find public communities matching your search."
                  : "There are no public communities to discover yet."
                }
                hint={query
                  ? "Try a different search term or clear your search."
                  : "Be the first — create a server and make it public!"
                }
              />
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => router.push("/channels/me")}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Create a Server
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {servers.map((server) => (
                  <div key={server.id} className="flex flex-col overflow-hidden rounded-lg bg-card transition-transform hover:scale-[1.02]">
                    <div className="flex h-20 items-center justify-center bg-popover">
                      <ServerIcon iconUrl={server.icon_url} serverName={server.name} />
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="mb-1 truncate font-semibold">{server.name}</h3>
                      {server.description && <p className="mb-3 flex-1 line-clamp-2 text-xs text-muted-foreground">{server.description}</p>}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3 w-3" /><span>{server.member_count.toLocaleString()}</span></div>
                        <Button type="button" size="sm" className="h-7 rounded px-3 text-xs" onClick={() => joinServer(server.invite_code)}>Join</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="flex justify-center py-6">
                {loadingMore && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    Loading more…
                  </div>
                )}
              </div>
            </>
          )
        ) : (
          <div className="space-y-8">
            {/* Curated discovery sections — only shown when not searching */}
            {!query && curatedSections.length > 0 && curatedSections.map((section) => (
              <section key={section.id}>
                <div className="mb-3 flex items-center gap-2">
                  {curatedSectionIcon(section.slug)}
                  <div>
                    <h2 className="text-base font-semibold">{section.title}</h2>
                    {section.description && (
                      <p className="text-xs text-muted-foreground">{section.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
                  {section.apps.map((app) => (
                    <div
                      key={app.id}
                      className="flex w-56 flex-shrink-0 flex-col rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-border hover:shadow-md"
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <AppIcon name={app.name} iconUrl={app.icon_url} />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold">{app.name}</h3>
                          {app.trust_badge && (
                            <span className={cn("flex items-center gap-1 text-[10px] font-medium", trustBadgeColor(app.trust_badge))}>
                              <BadgeCheck className="h-3 w-3" />
                              {trustBadgeLabel(app.trust_badge)}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mb-3 flex-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                        {app.description ?? "No description"}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span className="font-medium text-foreground">{app.average_rating.toFixed(1)}</span>
                        <span>({app.review_count})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {/* Divider between curated and catalog when both are shown */}
            {!query && curatedSections.length > 0 && apps.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-muted-foreground">All Apps</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}

            {/* Main app catalog grid — redesigned premium cards */}
            {apps.length === 0 ? (
              <BrandedEmptyState
                icon={BadgeCheck}
                title="No apps in this lane"
                description="No marketplace apps match your current search and category filters."
                hint="Reset filters to all categories to discover more tools."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {apps.map((app) => (
                  <div
                    key={app.id}
                    className="group flex flex-col rounded-xl border border-border/50 bg-card transition-all hover:border-border hover:shadow-md"
                  >
                    {/* Card header with icon and title */}
                    <div className="flex items-start gap-4 p-5 pb-0">
                      <AppIcon name={app.name} iconUrl={app.icon_url} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-base font-semibold">{app.name}</h3>
                          {app.trust_badge && (
                            <TrustBadgeTooltip badge={app.trust_badge} />
                          )}
                        </div>
                        <span className="text-xs capitalize text-muted-foreground">{app.category}</span>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="flex-1 px-5 pt-3 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      {app.description ?? "No description"}
                    </p>

                    {/* Rating and install */}
                    <div className="flex items-center justify-between px-5 pb-4 pt-4">
                      <div className="flex items-center gap-1.5">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={cn(
                                "h-3.5 w-3.5",
                                star <= Math.round(app.average_rating)
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-muted-foreground/30"
                              )}
                            />
                          ))}
                        </div>
                        <span className="text-xs font-medium">{app.average_rating.toFixed(1)}</span>
                        <span className="text-xs text-muted-foreground">({app.review_count})</span>
                      </div>
                      <div className="relative">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                          onClick={() => setPickerAppId(pickerAppId === app.id ? null : app.id)}
                          disabled={myServers.length === 0}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Install
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </Button>
                        {pickerAppId === app.id && myServers.length > 0 && (
                          <div
                            ref={pickerRef}
                            className="absolute right-0 top-full z-50 mt-1 w-56 max-h-48 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl"
                          >
                            {myServers.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                disabled={installingTo === s.id}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                                onClick={() => handleInstallClick(app, s.id)}
                              >
                                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                                  {s.name.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="truncate">{s.name}</span>
                                {installingTo === s.id && (
                                  <div className="ml-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pre-install confirmation for elevated permissions */}
      <AlertDialog open={!!confirmInstall} onOpenChange={(open) => { if (!open) setConfirmInstall(null) }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-orange-400" />
              Review permissions for {confirmInstall?.appName}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This app requests elevated permissions. Please review carefully before installing.
                </p>
                {confirmInstall && <PermissionList permissions={confirmInstall.permissions} />}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmInstall) {
                  installAppToServer(confirmInstall.appId, confirmInstall.serverId)
                  setConfirmInstall(null)
                }
              }}
            >
              Install anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
