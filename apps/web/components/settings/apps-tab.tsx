"use client"

import { useEffect, useState } from "react"
import { BadgeCheck, Shield, Star, Trash2, Settings, Package, ChevronRight, Clock, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils/cn"
import { WelcomeAppConfig } from "@/components/settings/welcome-app-config"
import { GiveawayAppConfig } from "@/components/settings/giveaway-app-config"
import { StandupAppConfig } from "@/components/settings/standup-app-config"
import { IncidentAppConfig } from "@/components/settings/incident-app-config"
import { ReminderAppConfig } from "@/components/settings/reminder-app-config"
import { RssFeedAppConfig } from "@/components/settings/rss-feed-app-config"
import { BibleAppConfig } from "@/components/settings/bible-app-config"
import { TRUST_BADGE_INFO } from "@vortex/shared"
import type { TrustBadgeType } from "@vortex/shared"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface InstalledApp {
  id: string
  app_id: string
  install_scopes: string[]
  granted_permissions: string[]
  installed_at: string
  app_catalog?: {
    name: string
    slug: string
    trust_badge: "verified" | "partner" | "internal" | null
  }
}

interface DiscoverApp {
  id: string
  name: string
  description: string | null
  category: string
  trust_badge: "verified" | "partner" | "internal" | null
  average_rating: number
  review_count: number
  icon_url?: string | null
}

interface AppsTabProps {
  serverId: string
  canManageApps: boolean
}

function AppAvatar({ name, iconUrl }: { name: string; iconUrl?: string | null }): React.ReactElement {
  const [imgFailed, setImgFailed] = useState(false)

  if (iconUrl && !imgFailed) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className="h-10 w-10 rounded-lg object-cover"
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
  ]
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length
  return (
    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold text-white", colors[idx])}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function TrustBadgePill({ badge }: { badge: TrustBadgeType }): React.ReactElement {
  const info = TRUST_BADGE_INFO[badge]
  const colorMap: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-400",
    purple: "border-purple-500/20 bg-purple-500/10 text-purple-400",
  }
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium", colorMap[info.color])}>
      <BadgeCheck className="h-3 w-3" />
      {info.label}
    </span>
  )
}

function formatRelativeDate(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  if (Number.isNaN(then)) return "Unknown"
  const diffMs = now - then
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 1) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

async function readErrorMessage(res: Response) {
  try {
    const payload = await res.json()
    if (payload?.error) return String(payload.error)
  } catch {
    // fallback below
  }

  return `Request failed (${res.status})`
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = 1,
  retryStatusCodes: number[] = [502, 503],
): Promise<Response> {
  const res = await fetch(url, init)
  if (retries > 0 && retryStatusCodes.includes(res.status)) {
    await new Promise((r) => setTimeout(r, 1000))
    return fetchWithRetry(url, init, retries - 1, retryStatusCodes)
  }
  return res
}

export function AppsTab({ serverId, canManageApps }: AppsTabProps) {
  const { toast } = useToast()
  const [installed, setInstalled] = useState<InstalledApp[]>([])
  const [market, setMarket] = useState<DiscoverApp[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAppId, setBusyAppId] = useState<string | null>(null)
  const [pendingUninstallId, setPendingUninstallId] = useState<string | null>(null)
  const [expandedAppSlug, setExpandedAppSlug] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const [installedRes, marketRes] = await Promise.all([
        fetchWithRetry(`/api/servers/${serverId}/apps`),
        fetchWithRetry(`/api/apps/discover`),
      ])

      if (!installedRes.ok) throw new Error(await readErrorMessage(installedRes))
      if (!marketRes.ok) throw new Error(await readErrorMessage(marketRes))

      setInstalled(await installedRes.json())
      setMarket(await marketRes.json())
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to load apps",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [serverId])

  async function install(appId: string) {
    setBusyAppId(appId)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
      if (!res.ok) throw new Error(await readErrorMessage(res))
      await refresh()
      toast({ title: "App installed" })
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Install failed",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setBusyAppId(null)
    }
  }

  async function confirmUninstall() {
    const appId = pendingUninstallId
    if (!appId) return
    setPendingUninstallId(null)
    setBusyAppId(appId)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps?appId=${appId}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await readErrorMessage(res))
      await refresh()
      toast({ title: "App uninstalled" })
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Uninstall failed",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setBusyAppId(null)
    }
  }

  const pendingAppName = pendingUninstallId
    ? (installed.find((a) => a.app_id === pendingUninstallId)?.app_catalog?.name ?? pendingUninstallId)
    : null

  const installedIds = new Set(installed.map((app) => app.app_id))

  return (
    <>
      <AlertDialog open={!!pendingUninstallId} onOpenChange={(open) => { if (!open) setPendingUninstallId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {pendingAppName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the app and revoke all its permissions from your server. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUninstall}
              className="motion-interactive"
              style={{ background: "var(--theme-danger)", color: "#fff" }}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-8">
        {/* Section: Installed Apps */}
        <section>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>Installed Apps</h3>
              <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Manage apps with scoped permissions on your server.</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="animate-pulse rounded-xl border p-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-32 rounded bg-muted" />
                      <div className="h-3 w-48 rounded bg-muted" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : installed.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed py-10" style={{ borderColor: "var(--theme-surface-elevated)" }}>
              <Package className="mb-2 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium" style={{ color: "var(--theme-text-muted)" }}>No apps installed yet</p>
              <p className="mt-1 text-xs" style={{ color: "var(--theme-text-muted)" }}>Browse the marketplace below to add apps.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {installed.map((entry) => {
                const slug = entry.app_catalog?.slug
                const hasConfig = slug === "welcome-guide" || slug === "giveaway-bot" || slug === "standup-assistant" || slug === "incident-bot" || slug === "reminder-bot" || slug === "rss-feed-bot" || slug === "bible-bot"
                const isExpanded = expandedAppSlug === slug
                const appName = entry.app_catalog?.name ?? entry.app_id
                return (
                  <div
                    key={entry.id}
                    className="overflow-hidden rounded-xl border transition-colors"
                    style={{ borderColor: isExpanded ? "var(--theme-primary)" : "var(--theme-surface-elevated)" }}
                  >
                    <div className="flex items-center gap-3 p-4">
                      <AppAvatar name={appName} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium" style={{ color: "var(--theme-text-bright)" }}>{appName}</span>
                          {entry.app_catalog?.trust_badge && (
                            <TrustBadgePill badge={entry.app_catalog.trust_badge} />
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" style={{ color: "var(--theme-text-muted)" }}>
                          <span className="flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            {entry.granted_permissions.length} permission{entry.granted_permissions.length !== 1 ? "s" : ""}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Installed {formatRelativeDate(entry.installed_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {hasConfig && canManageApps && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            aria-label={`Configure ${appName}`}
                            onClick={() => setExpandedAppSlug(isExpanded ? null : slug!)}
                          >
                            <Settings className="h-4 w-4" />
                            <span className="hidden sm:inline">Configure</span>
                            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs hover:text-destructive"
                          disabled={!canManageApps || busyAppId === entry.app_id}
                          aria-label={`Uninstall ${appName}`}
                          onClick={() => setPendingUninstallId(entry.app_id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t px-4 py-4" style={{ borderColor: "var(--theme-surface-elevated)" }}>
                        {slug === "welcome-guide" && <WelcomeAppConfig serverId={serverId} />}
                        {slug === "giveaway-bot" && <GiveawayAppConfig serverId={serverId} />}
                        {slug === "standup-assistant" && <StandupAppConfig serverId={serverId} />}
                        {slug === "incident-bot" && <IncidentAppConfig serverId={serverId} />}
                        {slug === "reminder-bot" && <ReminderAppConfig serverId={serverId} />}
                        {slug === "rss-feed-bot" && <RssFeedAppConfig serverId={serverId} />}
                        {slug === "bible-bot" && <BibleAppConfig serverId={serverId} />}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: "var(--theme-surface-elevated)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>Marketplace</span>
          <div className="h-px flex-1" style={{ background: "var(--theme-surface-elevated)" }} />
        </div>

        {/* Section: Marketplace quick install */}
        <section>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
              <Plus className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>Quick Install</h3>
              <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Add apps from the marketplace to your server.</p>
            </div>
          </div>
          {(() => {
            const visibleApps = market.filter((app) => !installedIds.has(app.id))
            if (!loading && visibleApps.length === 0) {
              return (
                <div className="flex flex-col items-center rounded-xl border border-dashed py-8" style={{ borderColor: "var(--theme-surface-elevated)" }}>
                  <BadgeCheck className="mb-2 h-8 w-8 text-emerald-400/50" />
                  <p className="text-sm font-medium" style={{ color: "var(--theme-text-muted)" }}>All caught up!</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--theme-text-muted)" }}>Every discoverable app is already installed.</p>
                </div>
              )
            }
            return (
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleApps.map((app) => (
                  <div
                    key={app.id}
                    className="group flex items-center gap-3 rounded-xl border p-3 transition-colors hover:border-primary/30"
                    style={{ borderColor: "var(--theme-surface-elevated)" }}
                  >
                    <AppAvatar name={app.name} iconUrl={app.icon_url} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>{app.name}</span>
                        {app.trust_badge && <TrustBadgePill badge={app.trust_badge} />}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: "var(--theme-text-muted)" }}>
                        <span className="capitalize">{app.category}</span>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {app.average_rating.toFixed(1)}
                        </span>
                        <span className="text-muted-foreground/50">({app.review_count})</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 shrink-0 gap-1 rounded-lg px-3 text-xs font-medium transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                      disabled={!canManageApps || busyAppId === app.id}
                      onClick={() => install(app.id)}
                    >
                      {busyAppId === app.id ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Install
                    </Button>
                  </div>
                ))}
              </div>
            )
          })()}
        </section>
      </div>
    </>
  )
}
