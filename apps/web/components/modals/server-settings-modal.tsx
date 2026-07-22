"use client"

import { useState, useEffect, useRef } from "react"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { Loader2, Copy, RefreshCw, Trash2, Webhook, Smile, Plus, Check, Shield, ShieldCheck, Zap, Upload, X, Clock, Users, Activity, Eye, Flag, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { evaluateRule } from "@/lib/automod"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import type { ServerRow, AutoModRuleRow, AutoModAction, AutoModRuleWithParsed, ScreeningConfigRow } from "@/types/database"
import { copyToClipboard, createWebhook, deleteWebhook, formatChannelName } from "@/lib/webhooks"
import { RoleManager } from "@/components/roles/role-manager"
import { TemplateManager } from "@/components/modals/template-manager"
import { AppsTab } from "@/components/settings/apps-tab"
import { ReportsTab } from "@/components/settings/reports-tab"
import { AdminActivityTimeline } from "@/components/admin/admin-activity-timeline"
import { PermissionSandbox } from "@/components/admin/permission-sandbox"
import { AiSettingsTab } from "@/components/settings/ai-settings-tab"

interface Channel {
  id: string
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
  server: ServerRow
  isOwner: boolean
  canManageApps?: boolean
  channels?: Channel[]
}

/** Tabbed server settings dialog with overview, invites, emojis, webhooks, moderation, screening, and automod configuration. */
export function ServerSettingsModal({ open, onClose, server, isOwner, canManageApps, channels = [] }: Props) {
  const { toast } = useToast()
  const isMobile = useMobileLayout()
  const { updateServer, removeServer, servers } = useAppStore(
    useShallow((s) => ({ updateServer: s.updateServer, removeServer: s.removeServer, servers: s.servers }))
  )
  const liveServer = servers.find((s) => s.id === server.id) ?? server
  const [loading, setLoading] = useState(false)
  const [deletingServer, setDeletingServer] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [name, setName] = useState(liveServer.name)
  const [description, setDescription] = useState(liveServer.description ?? "")
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [vanityUrl, setVanityUrl] = useState(liveServer.vanity_url ?? "")
  const [vanityLoading, setVanityLoading] = useState(false)
  const [vanityError, setVanityError] = useState<string | null>(null)
  const iconFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(liveServer.name)
    setDescription(liveServer.description ?? "")
    setVanityUrl(liveServer.vanity_url ?? "")
  }, [liveServer.name, liveServer.description, liveServer.vanity_url])

  // Revoke blob URL on unmount
  const iconPreviewRef = useRef(iconPreview)
  iconPreviewRef.current = iconPreview
  useEffect(() => {
    return () => {
      if (iconPreviewRef.current && iconPreviewRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(iconPreviewRef.current)
      }
    }
  }, [])

  function handleIconFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setIconFile(file)
    if (iconPreview) URL.revokeObjectURL(iconPreview)
    setIconPreview(URL.createObjectURL(file))
  }

  function clearIcon() {
    setIconFile(null)
    if (iconPreview) URL.revokeObjectURL(iconPreview)
    setIconPreview(null)
    if (iconFileRef.current) iconFileRef.current.value = ""
  }

  async function handleSave() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append("name", name.trim())
      formData.append("description", description.trim())
      if (iconFile) {
        formData.append("icon", iconFile)
      }

      const res = await fetch(`/api/servers/${server.id}`, {
        method: "PATCH",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to save server settings")
      }

      const updated = await res.json()
      updateServer(server.id, updated)
      clearIcon()
      toast({ title: "Server settings saved!" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to save", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerateInvite() {
    try {
      const res = await fetch(`/api/servers/${server.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate_invite: true }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to regenerate invite code")
      }

      const updated = await res.json()
      updateServer(server.id, updated)
      toast({ title: "Invite code regenerated!" })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to regenerate"
      toast({ variant: "destructive", title: "Failed to regenerate", description: message })
    }
  }

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(liveServer.invite_code)
      toast({ title: "Invite code copied!" })
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ServerSettingsModal] clipboard write failed", { action: "copyInvite", serverId: server.id })
      }
      toast({ variant: "destructive", title: "Copy failed" })
    }
  }

  async function copyVanityUrl(): Promise<void> {
    if (liveServer.vanity_url) {
      try {
        await navigator.clipboard.writeText(`${typeof window !== "undefined" ? window.location.origin : ""}/invite/${liveServer.vanity_url}`)
        toast({ title: "Vanity invite URL copied!" })
      } catch {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ServerSettingsModal] clipboard write failed", { action: "copyVanityUrl", serverId: server.id })
        }
        toast({ variant: "destructive", title: "Copy failed" })
      }
    }
  }

  async function handleSaveVanityUrl() {
    setVanityError(null)
    setVanityLoading(true)
    try {
      const value = vanityUrl.trim().toLowerCase() || null
      const res = await fetch(`/api/servers/${server.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vanity_url: value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setVanityError(data.error ?? "Failed to update vanity URL")
        return
      }
      const updated = await res.json()
      updateServer(server.id, updated)
      toast({ title: value ? "Vanity URL saved!" : "Vanity URL removed!" })
    } catch {
      setVanityError("Failed to update vanity URL")
    } finally {
      setVanityLoading(false)
    }
  }

  async function handleDeleteServer() {
    setDeletingServer(true)
    try {
      const res = await fetch(`/api/servers/${server.id}`, { method: "DELETE" })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to delete server")
      }

      removeServer(server.id)
      toast({ title: "Server deleted" })
      setShowDeleteConfirm(false)
      onClose()
      if (typeof window !== "undefined") {
        window.location.assign("/channels/me")
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete server"
      toast({ variant: "destructive", title: "Failed to delete server", description: message })
    } finally {
      setDeletingServer(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className={`p-0 ${isMobile ? 'h-[100dvh] w-screen max-w-none max-h-none rounded-none border-0' : 'h-[100dvh] w-screen max-w-none max-h-none sm:max-w-none sm:rounded-none rounded-none border-0'}`}
        style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)', paddingTop: isMobile ? 'env(safe-area-inset-top)' : undefined }}
        hideClose={isMobile}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{liveServer.name} — Server Settings</DialogTitle>

        {/* Mobile header with close button */}
        {isMobile && (
          <div
            className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
            style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-bg-tertiary)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15"
              style={{ color: 'var(--theme-text-secondary)' }}
              aria-label="Close server settings"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text-primary)' }}>
              {liveServer.name} — Settings
            </span>
          </div>
        )}

        <Tabs defaultValue="overview" orientation="vertical" className={`flex ${isMobile ? 'flex-col flex-1 min-h-0' : 'flex-row h-full'}`}>
          {/* Settings sidebar */}
          <div className={`flex-shrink-0 flex flex-col overflow-hidden ${isMobile ? 'hidden' : 'w-60'}`} style={{ background: 'var(--theme-bg-secondary)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider px-4 pt-4 pb-2 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
              {liveServer.name}
            </h3>
            <TabsList className="flex flex-col h-auto bg-transparent gap-0.5 w-full flex-1 overflow-y-auto px-4 pb-4 justify-start items-start">
              <TabsTrigger value="overview" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Overview
              </TabsTrigger>
              <TabsTrigger value="invites" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Invites
              </TabsTrigger>
              <TabsTrigger value="roles" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Roles
              </TabsTrigger>
              <TabsTrigger value="emojis" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Emoji
              </TabsTrigger>
              <TabsTrigger value="webhooks" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Webhooks
              </TabsTrigger>
              <TabsTrigger value="apps" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Apps
              </TabsTrigger>
              <div className="mt-2 mb-1 px-1 text-xs font-semibold uppercase tracking-wider hidden md:block" style={{ color: 'var(--theme-text-muted)' }}>
                Moderation
              </div>
              <TabsTrigger value="moderation" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                <Shield className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Settings
              </TabsTrigger>
              <TabsTrigger value="screening" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Screening
              </TabsTrigger>
              <TabsTrigger value="automod" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                <Zap className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                AutoMod
              </TabsTrigger>
              <TabsTrigger value="reports" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                <Flag className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Reports
              </TabsTrigger>
              <TabsTrigger value="templates" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                Templates
              </TabsTrigger>
              <div className="mt-2 mb-1 px-1 text-xs font-semibold uppercase tracking-wider hidden md:block" style={{ color: 'var(--theme-text-muted)' }}>
                Safety Tools
              </div>
              <TabsTrigger value="admin-activity" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                <Activity className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Activity
              </TabsTrigger>
              <TabsTrigger value="permission-sandbox" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                <Eye className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Perms
              </TabsTrigger>
              {isOwner && (
                <>
                  <div className="mt-2 mb-1 px-1 text-xs font-semibold uppercase tracking-wider hidden md:block" style={{ color: 'var(--theme-text-muted)' }}>
                    AI
                  </div>
                  <TabsTrigger value="ai" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                    AI Settings
                  </TabsTrigger>
                </>
              )}
            </TabsList>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 overflow-x-hidden">
            {isMobile && (
              <div className="flex flex-col" style={{ background: 'var(--theme-bg-secondary)' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wider px-4 pt-4 pb-2 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                  {liveServer.name}
                </h3>
                <TabsList className="flex flex-col gap-0.5 w-full bg-transparent px-4 pb-2 justify-start items-start h-auto">
                  <TabsTrigger value="overview" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="invites" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Invites
                  </TabsTrigger>
                  <TabsTrigger value="roles" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Roles
                  </TabsTrigger>
                  <TabsTrigger value="emojis" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Emoji
                  </TabsTrigger>
                  <TabsTrigger value="webhooks" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Webhooks
                  </TabsTrigger>
                  <TabsTrigger value="apps" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Apps
                  </TabsTrigger>
                  <div className="mt-2 mb-1 px-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Moderation
                  </div>
                  <TabsTrigger value="moderation" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" />
                    Settings
                  </TabsTrigger>
                  <TabsTrigger value="screening" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Screening
                  </TabsTrigger>
                  <TabsTrigger value="automod" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <Zap className="mr-1.5 h-3.5 w-3.5" />
                    AutoMod
                  </TabsTrigger>
                  <TabsTrigger value="reports" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <Flag className="mr-1.5 h-3.5 w-3.5" />
                    Reports
                  </TabsTrigger>
                  <TabsTrigger value="templates" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    Templates
                  </TabsTrigger>
                  <div className="mt-2 mb-1 px-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Safety Tools
                  </div>
                  <TabsTrigger value="admin-activity" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <Activity className="mr-1.5 h-3.5 w-3.5" />
                    Activity
                  </TabsTrigger>
                  <TabsTrigger value="permission-sandbox" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Perms
                  </TabsTrigger>
                  {isOwner && (
                    <>
                      <div className="mt-2 mb-1 px-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                        AI
                      </div>
                      <TabsTrigger value="ai" className="w-full justify-start whitespace-nowrap text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: 'var(--theme-text-secondary)' }}>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        AI Settings
                      </TabsTrigger>
                    </>
                  )}
                </TabsList>
              </div>
            )}
            <div className="w-full max-w-6xl">
            <TabsContent value="overview" className="mt-0 space-y-4">
              {/* Server Icon */}
              {isOwner && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                    Server Icon
                  </Label>
                  <div className="flex items-center gap-4">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Upload server icon"
                      onClick={() => iconFileRef.current?.click()}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); iconFileRef.current?.click() } }}
                      className="w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-white/50 transition-colors overflow-hidden relative"
                      style={{ borderColor: 'var(--theme-text-faint)' }}
                    >
                      {iconPreview || liveServer.icon_url ? (
                        <img
                          src={iconPreview || liveServer.icon_url!}
                          alt="Server icon"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center">
                          <Upload className="w-5 h-5 mx-auto mb-1" style={{ color: 'var(--theme-text-muted)' }} />
                          <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>UPLOAD</span>
                        </div>
                      )}
                    </div>
                    {iconPreview && (
                      <button
                        type="button"
                        onClick={clearIcon}
                        className="p-1.5 rounded hover:bg-white/10 transition-colors"
                        style={{ color: 'var(--theme-text-muted)' }}
                        title="Remove selected icon"
                        aria-label="Remove selected icon"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <input
                      ref={iconFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleIconFileChange}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="server-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                  Server Name
                </Label>
                <Input
                  id="server-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isOwner}
                  maxLength={100}
                  style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="server-description" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                  Description
                </Label>
                <textarea
                  id="server-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!isOwner}
                  rows={3}
                  maxLength={1024}
                  className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none"
                  style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-bg-tertiary)' }}
                  placeholder="What's this server about?"
                />
              </div>

              {isOwner && (
                <Button onClick={handleSave} disabled={loading} style={{ background: 'var(--theme-accent)' }}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              )}

              {isOwner && (
                <div className="mt-6 rounded-md border p-4" style={{ borderColor: "rgba(242,63,67,0.45)", background: "rgba(242,63,67,0.08)" }}>
                  <p className="text-sm font-semibold text-white">Danger Zone</p>
                  <p className="mt-1 text-xs" style={{ color: "color-mix(in srgb, var(--theme-danger) 70%, white)" }}>
                    Deleting this server permanently removes all channels and messages.
                  </p>
                  <Button
                    variant="destructive"
                    className="mt-3"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Server
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="invites" className="mt-0 space-y-4">
              {/* Legacy invite code section */}
              <div>
                <Label htmlFor="invite-code" className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: 'var(--theme-text-secondary)' }}>
                  Permanent Invite Code
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="invite-code"
                    value={liveServer.invite_code}
                    readOnly
                    style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={copyInvite}
                    style={{ color: 'var(--theme-text-muted)' }}
                    aria-label="Copy invite code"
                    aria-describedby="invite-code"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {isOwner && (
                <Button
                  variant="outline"
                  onClick={handleRegenerateInvite}
                  style={{ borderColor: 'var(--theme-text-faint)', color: 'var(--theme-text-secondary)', background: 'transparent' }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate Code
                </Button>
              )}

              {/* Vanity Invite URL */}
              {isOwner && (
                <div className="border-t pt-4 mt-4" style={{ borderColor: 'var(--theme-bg-tertiary)' }}>
                  <Label htmlFor="server-vanity-url" className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: 'var(--theme-text-secondary)' }}>
                    Vanity Invite URL
                  </Label>
                  <p className="text-xs mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                    Set a custom, memorable invite link for your server (e.g., <strong>gaming-hub</strong>).
                  </p>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center rounded overflow-hidden" style={{ background: 'var(--theme-bg-tertiary)', border: '1px solid var(--theme-bg-tertiary)' }}>
                      <span className="px-2 text-xs shrink-0" style={{ color: 'var(--theme-text-muted)' }}>/invite/</span>
                      <input
                        id="server-vanity-url"
                        type="text"
                        value={vanityUrl}
                        onChange={(e) => { setVanityUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setVanityError(null) }}
                        placeholder="my-server"
                        maxLength={32}
                        className="flex-1 bg-transparent py-2 pr-2 text-sm focus:outline-none"
                        style={{ color: 'var(--theme-text-primary)' }}
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleSaveVanityUrl}
                      disabled={vanityLoading}
                      style={{ borderColor: 'var(--theme-accent)', color: 'var(--theme-accent)', background: 'transparent' }}
                    >
                      {vanityLoading ? "Saving..." : "Save"}
                    </Button>
                    {liveServer.vanity_url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={copyVanityUrl}
                        style={{ color: 'var(--theme-text-muted)' }}
                        aria-label="Copy vanity invite URL"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  {vanityError && (
                    <p className="text-xs mt-1" style={{ color: 'var(--theme-danger)' }}>{vanityError}</p>
                  )}
                  {liveServer.vanity_url && !vanityError && (
                    <p className="text-xs mt-1" style={{ color: 'var(--theme-success)' }}>
                      Active: /invite/{liveServer.vanity_url}
                    </p>
                  )}
                </div>
              )}

              <div className="border-t pt-4 mt-4" style={{ borderColor: 'var(--theme-bg-tertiary)' }}>
                <InvitesManager serverId={server.id} isOwner={isOwner} />
              </div>
            </TabsContent>

            <TabsContent value="roles" className="mt-0">
              <RoleManager serverId={server.id} isOwner={isOwner} />
            </TabsContent>

            <TabsContent value="emojis" className="mt-0">
              <EmojisTab serverId={server.id} />
            </TabsContent>

            <TabsContent value="webhooks" className="mt-0">
              <WebhooksTab serverId={server.id} channels={channels} open />
            </TabsContent>

            <TabsContent value="apps" className="mt-0">
              <AppsTab serverId={server.id} canManageApps={canManageApps ?? isOwner} />
            </TabsContent>

            <TabsContent value="moderation" className="mt-0">
              <ModerationTab serverId={server.id} open />
            </TabsContent>

            <TabsContent value="screening" className="mt-0">
              <ScreeningTab serverId={server.id} open />
            </TabsContent>

            <TabsContent value="automod" className="mt-0">
              <AutoModTab serverId={server.id} channels={channels} open />
            </TabsContent>

            <TabsContent value="reports" className="mt-0">
              <ReportsTab serverId={server.id} />
            </TabsContent>

            <TabsContent value="templates" className="mt-0">
              {isOwner ? <TemplateManager serverId={server.id} /> : <p style={{ color: 'var(--theme-text-secondary)' }}>Only the owner can import/export templates.</p>}
            </TabsContent>

            <TabsContent value="admin-activity" className="mt-0">
              <AdminActivityTimeline serverId={server.id} />
            </TabsContent>

            <TabsContent value="permission-sandbox" className="mt-0">
              <PermissionSandbox serverId={server.id} channels={channels} />
            </TabsContent>

            {isOwner && (
              <TabsContent value="ai" className="mt-0">
                <AiSettingsTab serverId={server.id} />
              </TabsContent>
            )}
            </div>

          </div>
        </Tabs>
    </DialogContent>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}>
          <DialogHeader>
            <DialogTitle>Delete server?</DialogTitle>
            <DialogDescription style={{ color: 'var(--theme-text-secondary)' }}>
              This action is irreversible and will permanently remove
              <span className="font-semibold text-white"> {liveServer.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteServer} disabled={deletingServer}>
              {deletingServer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

// ── Emojis Tab ────────────────────────────────────────────────────────────────

interface EmojiEntry {
  id: string
  name: string
  image_url: string
  created_at?: string
  uploader_id?: string
  uploader?: { id: string; display_name: string; avatar_url: string | null } | null
}

const CUSTOM_EMOJI_LIMIT = 50

/** Emoji management tab — lists server custom emojis with upload, rename, and delete controls. */
export function EmojisTab({ serverId }: { serverId: string }) {
  const { toast } = useToast()
  const [emojis, setEmojis] = useState<EmojiEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [newName, setNewName] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/servers/${serverId}/emojis`)
      .then((r) => r.json())
      .then((d) => { setEmojis(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [serverId])

  async function handleUpload() {
    const file = selectedFile ?? fileRef.current?.files?.[0]
    if (!file || !newName.trim()) return
    if (emojis.length >= CUSTOM_EMOJI_LIMIT) {
      toast({ variant: "destructive", title: `Emoji limit reached (${CUSTOM_EMOJI_LIMIT})` })
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("name", newName.trim())
      const res = await fetch(`/api/servers/${serverId}/emojis`, { method: "POST", body: form })
      if (res.ok) {
        const emoji = await res.json()
        setEmojis((prev) => {
          const withoutSameName = prev.filter((entry) => entry.name !== emoji.name)
          return [...withoutSameName, emoji].sort((a, b) => a.name.localeCompare(b.name))
        })
        setNewName("")
        setSelectedFile(null)
        if (fileRef.current) fileRef.current.value = ""
        toast({ title: "Emoji uploaded" })
      } else {
        const error = await res.json().catch(() => null)
        toast({ variant: "destructive", title: error?.error || "Failed to upload emoji" })
      }
    } catch (error) {
      const isNetwork = error instanceof TypeError && /fetch|network/i.test(error.message)
      toast({
        variant: "destructive",
        title: isNetwork
          ? "Network error — please try again"
          : (error instanceof Error ? error.message : "Failed to upload emoji"),
      })
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/servers/${serverId}/emojis?emojiId=${id}`, { method: "DELETE" })
    if (res.ok) {
      setEmojis((prev) => prev.filter((e) => e.id !== id))
      toast({ title: "Emoji deleted" })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-white font-semibold mb-0.5">Custom Emoji</p>
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          Upload custom emoji to use in messages on this server. Max 256 KB, PNG/GIF/WEBP.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
          {emojis.length} / {CUSTOM_EMOJI_LIMIT} custom emojis used.
        </p>
      </div>

      {/* Upload form */}
      <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-bg-tertiary)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>Upload Emoji</p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase())}
            placeholder="emoji_name"
            className="flex-1 min-w-0 px-3 py-2 rounded text-sm focus:outline-none"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              setSelectedFile(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-3 py-2 rounded text-sm transition-colors"
            style={{ background: 'var(--theme-surface-input)', color: 'var(--theme-text-secondary)' }}
          >
            {selectedFile ? selectedFile.name : "Choose file"}
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !newName.trim() || !selectedFile || emojis.length >= CUSTOM_EMOJI_LIMIT}
            className="px-3 py-2 rounded text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--theme-accent)', color: 'white' }}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload"}
          </button>
        </div>
      </div>

      {/* Emoji list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : emojis.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          No custom emoji yet.
        </div>
      ) : (
        <div className="space-y-1">
          {emojis.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--theme-bg-secondary)' }}>
              <img src={e.image_url} alt={e.name} className="w-8 h-8 object-contain rounded" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white">:{e.name}:</span>
                {e.uploader && (
                  <p className="text-[11px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
                    Uploaded by {e.uploader.display_name}
                    {e.created_at && <> &middot; {new Date(e.created_at).toLocaleDateString()}</>}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleDelete(e.id)}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors"
                style={{ color: 'var(--theme-text-faint)' }}
                title="Delete"
                aria-label={`Delete emoji :${e.name}:`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Webhooks Tab ──────────────────────────────────────────────────────────────

interface WebhookEntry {
  id: string
  name: string
  channel_id: string
  url: string
  created_at: string
}

/** Webhook management tab — lists webhooks with create, copy-URL, and delete controls. Lazy-loads data when the tab is opened. */
export function WebhooksTab({ serverId, channels, open }: { serverId: string; channels: Channel[]; open: boolean }) {
  const { toast } = useToast()
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("Webhook")
  const [newChannelId, setNewChannelId] = useState(channels[0]?.id ?? "")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/servers/${serverId}/webhooks`)
      .then((r) => r.json())
      .then((d) => { setWebhooks(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open, serverId])

  // Update default channel when channels list arrives
  useEffect(() => {
    if (!newChannelId && channels[0]) setNewChannelId(channels[0].id)
  }, [channels, newChannelId])

  async function handleCreate() {
    if (!newChannelId) return
    setCreating(true)
    try {
      const res = await createWebhook(serverId, newChannelId, newName)
      if (res.ok) {
        const wh = await res.json()
        setWebhooks((prev) => [...prev, wh])
        setNewName("Webhook")
        toast({ title: "Webhook created" })
      } else {
        const data = await res.json().catch(() => ({ error: "Failed to create webhook" }))
        toast({ variant: "destructive", title: "Failed to create webhook", description: data.error })
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to create webhook", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await deleteWebhook(serverId, id)
      if (res.ok) {
        setWebhooks((prev) => prev.filter((w) => w.id !== id))
        toast({ title: "Webhook deleted" })
      } else {
        const data = await res.json().catch(() => ({ error: "Failed to delete webhook" }))
        toast({ variant: "destructive", title: "Failed to delete webhook", description: data.error })
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to delete webhook", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setDeletingId(null)
    }
  }

  async function copyUrl(id: string, url: string) {
    try {
      await copyToClipboard(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Clipboard write failed; avoid showing copied state
    }
  }

  function channelName(channelId: string) {
    return formatChannelName(channelId, channels)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-white font-semibold mb-0.5 flex items-center gap-2">
          <Webhook className="w-4 h-4" style={{ color: 'var(--theme-accent)' }} />
          Webhooks
        </p>
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          Create URLs that allow external services to post messages to your server.
        </p>
      </div>

      {/* Create form */}
      <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-bg-tertiary)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>New Webhook</p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Webhook name"
            className="flex-1 px-3 py-2 rounded text-sm focus:outline-none"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
          />
          <select
            value={newChannelId}
            onChange={(e) => setNewChannelId(e.target.value)}
            className="px-2 py-2 rounded text-sm focus:outline-none"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={creating || !newChannelId}
            className="px-3 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--theme-accent)', color: 'white' }}
            aria-label="Create webhook"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          No webhooks yet. Create one above.
        </div>
      ) : (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <div key={wh.id} className="rounded-lg p-3" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-bg-tertiary)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-medium text-white">{wh.name}</p>
                  <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>#{channelName(wh.channel_id)}</p>
                </div>
                <button
                  onClick={() => handleDelete(wh.id)}
                  disabled={deletingId === wh.id}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  style={{ color: 'var(--theme-text-faint)' }}
                  title="Delete"
                  aria-label={`Delete webhook ${wh.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs px-2 py-1 rounded truncate font-mono" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}>
                  {wh.url}
                </code>
                <button
                  onClick={() => copyUrl(wh.id, wh.url)}
                  className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-white/10"
                  style={{ color: copiedId === wh.id ? 'var(--theme-success)' : 'var(--theme-text-muted)' }}
                  title="Copy URL"
                  aria-label="Copy webhook URL"
                >
                  {copiedId === wh.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Moderation Settings Tab ───────────────────────────────────────────────────

const VERIFICATION_LEVELS = [
  { value: 0, label: "None", description: "Unrestricted" },
  { value: 1, label: "Low", description: "Must have verified email" },
  { value: 2, label: "Medium", description: "Must be registered for > 5 min" },
  { value: 3, label: "High", description: "Must be a member for > 10 min" },
  { value: 4, label: "Very High", description: "Must have verified phone" },
]

const CONTENT_FILTERS = [
  { value: 0, label: "Disabled" },
  { value: 1, label: "Scan messages from members without roles" },
  { value: 2, label: "Scan all messages" },
]

interface ModerationSettings {
  verification_level: number
  explicit_content_filter: number
  default_message_notifications: number
  screening_enabled: boolean
  join_role_id: string | null
}

/** Moderation settings tab — verification level, explicit-content filter, and default notification preferences. */
export function ModerationTab({ serverId, open }: { serverId: string; open: boolean }) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<ModerationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [roles, setRoles] = useState<{ id: string; name: string; color: string; is_default: boolean }[]>([])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      fetch(`/api/servers/${serverId}/moderation`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
      fetch(`/api/servers/${serverId}/roles`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([modData, rolesData]) => {
        setSettings(modData)
        setRoles(rolesData)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open, serverId])

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    const res = await fetch(`/api/servers/${serverId}/moderation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
    if (res.ok) {
      toast({ title: "Moderation settings saved" })
    } else {
      const d = await res.json()
      toast({ variant: "destructive", title: "Failed to save", description: d.error })
    }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} /></div>
  if (!settings) return null

  return (
    <div className="space-y-6">
      <div>
        <p className="text-white font-semibold flex items-center gap-2 mb-0.5">
          <Shield className="w-4 h-4" style={{ color: 'var(--theme-accent)' }} />
          Moderation Settings
        </p>
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          Configure server-level safety and content filters.
        </p>
      </div>

      {/* Verification Level */}
      <div className="space-y-2">
        <Label htmlFor="server-verification-level" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
          Verification Level
        </Label>
        <select
          id="server-verification-level"
          value={settings.verification_level}
          onChange={(e) => setSettings({ ...settings, verification_level: Number(e.target.value) })}
          className="w-full px-3 py-2 rounded text-sm focus:outline-none"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
        >
          {VERIFICATION_LEVELS.map((v) => (
            <option key={v.value} value={v.value}>{v.label} — {v.description}</option>
          ))}
        </select>
      </div>

      {/* Explicit Content Filter */}
      <div className="space-y-2">
        <Label htmlFor="server-explicit-content-filter" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
          Explicit Content Filter
        </Label>
        <select
          id="server-explicit-content-filter"
          value={settings.explicit_content_filter}
          onChange={(e) => setSettings({ ...settings, explicit_content_filter: Number(e.target.value) })}
          className="w-full px-3 py-2 rounded text-sm focus:outline-none"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
        >
          {CONTENT_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Default Notifications */}
      <div className="space-y-2">
        <Label htmlFor="server-default-notifications" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
          Default Message Notifications
        </Label>
        <select
          id="server-default-notifications"
          value={settings.default_message_notifications}
          onChange={(e) => setSettings({ ...settings, default_message_notifications: Number(e.target.value) })}
          className="w-full px-3 py-2 rounded text-sm focus:outline-none"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
        >
          <option value={0}>All Messages</option>
          <option value={1}>Only @mentions</option>
        </select>
      </div>

      {/* Screening Toggle */}
      <div className="flex items-center justify-between rounded-lg p-3" style={{ background: 'var(--theme-bg-secondary)' }}>
        <div>
          <p className="text-sm font-medium text-white">Membership Screening</p>
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Require new members to accept rules before participating</p>
        </div>
        <button
          onClick={() => setSettings({ ...settings, screening_enabled: !settings.screening_enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${settings.screening_enabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.screening_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Auto-assign Role on Join */}
      <div className="space-y-2">
        <Label htmlFor="server-join-role" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
          Auto-assign Role on Join
        </Label>
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          Automatically give new members this role when they join the server.
        </p>
        <select
          id="server-join-role"
          value={settings.join_role_id ?? ""}
          onChange={(e) => setSettings({ ...settings, join_role_id: e.target.value || null })}
          className="w-full px-3 py-2 rounded text-sm focus:outline-none"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
        >
          <option value="">— None —</option>
          {roles.filter((r) => !r.is_default).map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <Button onClick={handleSave} disabled={saving} style={{ background: 'var(--theme-accent)' }}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save Changes
      </Button>
    </div>
  )
}

// ── Screening Tab ────────────────────────────────────────────────────────────

/** Member screening tab — configures a rules/welcome gate that new members must accept before participating. */
export function ScreeningTab({ serverId, open }: { serverId: string; open: boolean }) {
  const { toast } = useToast()
  const [config, setConfig] = useState<ScreeningConfigRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState("Server Rules")
  const [description, setDescription] = useState("")
  const [rulesText, setRulesText] = useState("")
  const [screeningEnabled, setScreeningEnabled] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      fetch(`/api/servers/${serverId}/screening`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
      fetch(`/api/servers/${serverId}/moderation`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
    ])
      .then(([screeningData, moderationData]) => {
        const cfg = screeningData.config as ScreeningConfigRow | null
        setConfig(cfg)
        if (cfg) {
          setTitle(cfg.title)
          setDescription(cfg.description ?? "")
          setRulesText(cfg.rules_text)
        }
        setScreeningEnabled(moderationData.screening_enabled ?? false)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open, serverId])

  async function handleSave() {
    setSaving(true)
    const [screeningRes, moderationRes] = await Promise.all([
      fetch(`/api/servers/${serverId}/screening`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: description || null, rules_text: rulesText }),
      }),
      fetch(`/api/servers/${serverId}/moderation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screening_enabled: screeningEnabled }),
      }),
    ])
    if (screeningRes.ok && moderationRes.ok) {
      const updated = await screeningRes.json()
      setConfig(updated)
      toast({ title: "Screening rules saved" })
    } else {
      const failed = !screeningRes.ok ? screeningRes : moderationRes
      const d = await failed.json().catch(() => ({}))
      toast({ variant: "destructive", title: "Failed to save", description: d.error })
    }
    setSaving(false)
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/servers/${serverId}/screening`, { method: "DELETE" })
      if (res.ok) {
        setConfig(null)
        setTitle("Server Rules")
        setDescription("")
        setRulesText("")
        toast({ title: "Screening config removed" })
      } else {
        const d = await res.json().catch(() => ({}))
        toast({ variant: "destructive", title: "Failed to remove", description: d.error ?? "Unknown error" })
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to remove", description: "Network error" })
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} /></div>

  return (
    <div className="space-y-4">
      <div>
        <p className="text-white font-semibold flex items-center gap-2 mb-0.5">
          <ShieldCheck className="w-4 h-4" style={{ color: 'var(--theme-accent)' }} />
          Membership Screening
        </p>
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          New members must read and accept these rules before they can send messages.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="screening-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>Title</Label>
        <Input
          id="screening-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-surface-elevated)', color: 'var(--theme-text-primary)' }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="screening-description" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>Description (optional)</Label>
        <Input
          id="screening-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short intro shown above the rules"
          style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-surface-elevated)', color: 'var(--theme-text-primary)' }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="screening-rules-text" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>Rules Text</Label>
        <textarea
          id="screening-rules-text"
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={8}
          className="w-full rounded px-3 py-2 text-sm resize-none focus:outline-none"
          placeholder="1. Be respectful&#10;2. No spam&#10;..."
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setScreeningEnabled(!screeningEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${screeningEnabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${screeningEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
        <span className="text-sm text-white">Require acceptance to participate</span>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} style={{ background: 'var(--theme-accent)' }}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Rules
        </Button>
        {config && (
          <Button variant="ghost" onClick={handleDelete} style={{ color: 'var(--theme-danger)' }}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

// ── AutoMod Tab ──────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  keyword_filter: "Keyword Filter",
  regex_filter: "Regex Filter",
  mention_spam: "Mention Spam",
  link_spam: "Link Spam",
  rapid_message: "Rapid Message",
}

interface AutoModRuleForm {
  name: string
  trigger_type: string
  // keyword_filter
  keywords: string
  regex_patterns: string
  // mention_spam
  mention_threshold: number
  // link_spam
  link_threshold: number
  // rapid_message
  message_threshold: number
  window_seconds: number
  // conditions
  channel_scope: string
  role_scope: string
  min_account_age_minutes: number
  min_trust_level: number
  priority: number
  // actions
  block_message: boolean
  quarantine_message: boolean
  timeout_member: boolean
  timeout_duration: number
  warn_member: boolean
  alert_channel: boolean
  alert_channel_id: string
  enabled: boolean
}

const DEFAULT_FORM: AutoModRuleForm = {
  name: "",
  trigger_type: "keyword_filter",
  keywords: "",
  regex_patterns: "",
  mention_threshold: 5,
  link_threshold: 3,
  message_threshold: 6,
  window_seconds: 10,
  channel_scope: "",
  role_scope: "",
  min_account_age_minutes: 0,
  min_trust_level: 0,
  priority: 100,
  block_message: true,
  quarantine_message: false,
  timeout_member: false,
  timeout_duration: 60,
  warn_member: false,
  alert_channel: false,
  alert_channel_id: "",
  enabled: true,
}

function formToPayload(f: AutoModRuleForm) {
  let config: Record<string, unknown> = {}
  if (f.trigger_type === "keyword_filter") {
    config = { keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean) }
  } else if (f.trigger_type === "regex_filter") {
    config = { regex_patterns: f.regex_patterns.split(",").map((p) => p.trim()).filter(Boolean) }
  } else if (f.trigger_type === "mention_spam") {
    config = { mention_threshold: f.mention_threshold }
  } else if (f.trigger_type === "link_spam") {
    config = { link_threshold: f.link_threshold }
  } else if (f.trigger_type === "rapid_message") {
    config = { message_threshold: f.message_threshold, window_seconds: f.window_seconds }
  }

  const conditions = {
    channel_ids: f.channel_scope ? [f.channel_scope] : [],
    role_ids: f.role_scope ? [f.role_scope] : [],
    min_account_age_minutes: f.min_account_age_minutes,
    min_trust_level: f.min_trust_level,
  }

  const actions: AutoModAction[] = []
  if (f.block_message) actions.push({ type: "block_message" })
  if (f.quarantine_message) actions.push({ type: "quarantine_message" })
  if (f.timeout_member) actions.push({ type: "timeout_member", duration_seconds: f.timeout_duration })
  if (f.warn_member) actions.push({ type: "warn_member" })
  if (f.alert_channel && f.alert_channel_id) actions.push({ type: "alert_channel", channel_id: f.alert_channel_id })

  return { name: f.name, trigger_type: f.trigger_type, config, conditions, priority: f.priority, actions, enabled: f.enabled }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function ruleToForm(rule: AutoModRuleRow): AutoModRuleForm {
  const cfg = isRecord(rule.config) ? rule.config : {}
  const rawConditions = (rule as { conditions?: unknown }).conditions
  const conditions = isRecord(rawConditions) ? rawConditions : {}
  const actions = rule.actions as unknown as AutoModAction[]
  return {
    name: rule.name,
    trigger_type: rule.trigger_type,
    keywords: asStringArray(cfg.keywords).join(", "),
    regex_patterns: asStringArray(cfg.regex_patterns).join(", "),
    mention_threshold: typeof cfg.mention_threshold === "number" ? cfg.mention_threshold : 5,
    link_threshold: typeof cfg.link_threshold === "number" ? cfg.link_threshold : 3,
    message_threshold: typeof cfg.message_threshold === "number" ? cfg.message_threshold : 6,
    window_seconds: typeof cfg.window_seconds === "number" ? cfg.window_seconds : 10,
    channel_scope: asStringArray(conditions.channel_ids)[0] ?? "",
    role_scope: asStringArray(conditions.role_ids)[0] ?? "",
    min_account_age_minutes: typeof conditions.min_account_age_minutes === "number" ? conditions.min_account_age_minutes : 0,
    min_trust_level: typeof conditions.min_trust_level === "number" ? conditions.min_trust_level : 0,
    priority: (rule as { priority?: number }).priority ?? 100,
    block_message: actions.some((a) => a.type === "block_message"),
    quarantine_message: actions.some((a) => a.type === "quarantine_message"),
    timeout_member: actions.some((a) => a.type === "timeout_member"),
    timeout_duration: actions.find((a) => a.type === "timeout_member")?.duration_seconds ?? 60,
    warn_member: actions.some((a) => a.type === "warn_member"),
    alert_channel: actions.some((a) => a.type === "alert_channel"),
    alert_channel_id: actions.find((a) => a.type === "alert_channel")?.channel_id ?? "",
    enabled: rule.enabled,
  }
}

function upsertAutomodRule(rules: AutoModRuleRow[], editingId: string | "new", saved: AutoModRuleRow): AutoModRuleRow[] {
  if (editingId === "new") {
    return [...rules, saved]
  }
  return rules.map((r) => (r.id === editingId ? saved : r))
}

/** AutoMod rules tab — create, edit, test, and toggle automated moderation rules with configurable triggers and actions. */
export function AutoModTab({ serverId, channels, open }: { serverId: string; channels: Channel[]; open: boolean }) {
  const { toast } = useToast()
  const [rules, setRules] = useState<AutoModRuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | "new" | null>(null)
  const [form, setForm] = useState<AutoModRuleForm>(DEFAULT_FORM)
  const [sampleMessage, setSampleMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AutoModRuleRow | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/servers/${serverId}/automod`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => { setRules(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open, serverId])

  function startNew() {
    setForm({ ...DEFAULT_FORM, alert_channel_id: channels[0]?.id ?? "" })
    setEditingId("new")
  }

  function startEdit(rule: AutoModRuleRow) {
    setForm(ruleToForm(rule))
    setEditingId(rule.id)
  }

  async function handleSave() {
    if (!form.name.trim() || !editingId) return
    setSaving(true)
    const payload = formToPayload(form)
    let res: Response
    if (editingId === "new") {
      res = await fetch(`/api/servers/${serverId}/automod`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch(`/api/servers/${serverId}/automod/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    }
    if (res.ok) {
      const saved = await res.json()
      setRules((prev) => upsertAutomodRule(prev, editingId, saved))
      setEditingId(null)
      toast({ title: editingId === "new" ? "Rule created" : "Rule updated" })
    } else {
      const d = await res.json()
      toast({ variant: "destructive", title: "Failed to save", description: d.error })
    }
    setSaving(false)
  }

  async function handleDelete(ruleId: string) {
    const res = await fetch(`/api/servers/${serverId}/automod/${ruleId}`, { method: "DELETE" })
    if (res.ok) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId))
      if (editingId === ruleId) setEditingId(null)
      toast({ title: "Rule deleted" })
      setDeleteTarget(null)
    }
  }

  async function toggleEnabled(rule: AutoModRuleRow) {
    try {
      const res = await fetch(`/api/servers/${serverId}/automod/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (res.ok) {
        const updated = await res.json()
        setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)))
      } else {
        toast({ title: "Failed to toggle rule", description: "Could not update rule state. Please try again.", variant: "destructive" })
      }
    } catch {
      toast({ title: "Failed to toggle rule", description: "A network error occurred. Please try again.", variant: "destructive" })
    }
  }

  async function movePriority(rule: AutoModRuleRow, direction: -1 | 1) {
    const ordered = [...rules].sort((a: AutoModRuleRow, b: AutoModRuleRow) => ((a.priority as number) ?? 100) - ((b.priority as number) ?? 100))
    const index = ordered.findIndex((r) => r.id === rule.id)
    const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return
    const current = ordered[index]
    const other = ordered[swapIndex]
    try {
      const [res1, res2] = await Promise.all([
        fetch(`/api/servers/${serverId}/automod/${current.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: other.priority ?? 100 }) }),
        fetch(`/api/servers/${serverId}/automod/${other.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: current.priority ?? 100 }) }),
      ])
      if (!res1.ok || !res2.ok) {
        toast({ title: "Failed to reorder rules", description: "Could not update rule priorities. Please try again.", variant: "destructive" })
        return
      }
      const refreshRes = await fetch(`/api/servers/${serverId}/automod`)
      const refreshed = refreshRes.ok ? await refreshRes.json() : null
      if (!refreshed) return
      setRules(Array.isArray(refreshed) ? refreshed : [])
    } catch {
      toast({ title: "Failed to reorder rules", description: "A network error occurred. Please try again.", variant: "destructive" })
    }
  }

  function updateForm(key: keyof AutoModRuleForm, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const sampleViolation = sampleMessage.trim()
    ? evaluateRule(
        {
          id: "preview",
          server_id: serverId,
          name: form.name || "Preview Rule",
          trigger_type: form.trigger_type as AutoModRuleWithParsed["trigger_type"],
          config: formToPayload(form).config as unknown as AutoModRuleWithParsed["config"],
          conditions: formToPayload(form).conditions as AutoModRuleWithParsed["conditions"],
          actions: formToPayload(form).actions,
          priority: form.priority,
          enabled: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        sampleMessage,
        [],
        { accountAgeMinutes: Infinity, recentMessageCount: 0 }
      )
    : null

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-white font-semibold flex items-center gap-2 mb-0.5">
            <Zap className="w-4 h-4" style={{ color: 'var(--theme-accent)' }} />
            AutoMod Rules
          </p>
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            Rules that automatically moderate messages in this server.
          </p>
        </div>
        <Button size="sm" onClick={startNew} style={{ background: 'var(--theme-accent)' }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> New Rule
        </Button>
      </div>

      {/* Existing rules list */}
      {rules.length === 0 && editingId !== "new" && (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          No AutoMod rules yet. Create one to get started.
        </div>
      )}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg p-3 flex items-center gap-3" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-bg-tertiary)' }}>
            <button
              onClick={() => toggleEnabled(rule)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${rule.enabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{rule.name}</p>
              <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}</p>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => movePriority(rule, -1)}
                className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/10"
                style={{ color: 'var(--theme-text-secondary)' }}
              >↑</button>
              <button
                onClick={() => movePriority(rule, 1)}
                className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/10"
                style={{ color: 'var(--theme-text-secondary)' }}
              >↓</button>
              <button
                onClick={() => startEdit(rule)}
                className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/10"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteTarget(rule)}
                className="text-xs px-2 py-1 rounded hover:bg-red-500/20 transition-colors"
                style={{ color: 'var(--theme-danger)' }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Rule editor form */}
      {editingId !== null && (
        <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-surface-elevated)' }}>
          <p className="text-sm font-semibold text-white">{editingId === "new" ? "New Rule" : "Edit Rule"}</p>

          <div className="space-y-1">
            <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Rule name</label>
            <input
              value={form.name}
              onChange={(e) => updateForm("name", e.target.value)}
              placeholder="My Rule"
              className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Trigger type</label>
            <select
              value={form.trigger_type}
              onChange={(e) => updateForm("trigger_type", e.target.value)}
              className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
            >
              <option value="keyword_filter">Keyword Filter</option>
              <option value="regex_filter">Regex Filter</option>
              <option value="mention_spam">Mention Spam</option>
              <option value="link_spam">Link Spam</option>
              <option value="rapid_message">Rapid Message</option>
            </select>
          </div>

          {form.trigger_type === "keyword_filter" && (
            <>
              <div className="space-y-1">
                <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Blocked keywords (comma-separated)</label>
                <input
                  value={form.keywords}
                  onChange={(e) => updateForm("keywords", e.target.value)}
                  placeholder="spam, badword, ..."
                  className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
                  style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Priority (lower runs first)</label>
                <input
                  type="number"
                  min={1}
                  value={form.priority}
                  onChange={(e) => updateForm("priority", Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
                  style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Regex patterns (comma-separated, optional)</label>
                <input
                  value={form.regex_patterns}
                  onChange={(e) => updateForm("regex_patterns", e.target.value)}
                  placeholder="\\bspam\\b, ..."
                  className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
                  style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
                />
              </div>
            </>
          )}

          {form.trigger_type === "regex_filter" && (
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Regex patterns (comma-separated)</label>
              <input
                value={form.regex_patterns}
                onChange={(e) => updateForm("regex_patterns", e.target.value)}
                placeholder="\\bspam\\b, ..."
                className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
                style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
              />
            </div>
          )}

          {form.trigger_type === "mention_spam" && (
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Max mentions per message</label>
              <input
                type="number"
                min={1}
                value={form.mention_threshold}
                onChange={(e) => updateForm("mention_threshold", Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
                style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
              />
            </div>
          )}

          {form.trigger_type === "link_spam" && (
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Max links per message</label>
              <input
                type="number"
                min={1}
                value={form.link_threshold}
                onChange={(e) => updateForm("link_threshold", Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
                style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
              />
            </div>
          )}

          {form.trigger_type === "rapid_message" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Messages in window</label>
                <input type="number" min={1} value={form.message_threshold} onChange={(e) => updateForm("message_threshold", Number(e.target.value))} className="w-full px-3 py-1.5 rounded text-sm focus:outline-none" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }} />
              </div>
              <div className="space-y-1">
                <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Window (seconds)</label>
                <input type="number" min={1} value={form.window_seconds} onChange={(e) => updateForm("window_seconds", Number(e.target.value))} className="w-full px-3 py-1.5 rounded text-sm focus:outline-none" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Channel scope (optional)</label>
              <select value={form.channel_scope} onChange={(e) => updateForm("channel_scope", e.target.value)} className="w-full px-2 py-1 rounded text-sm focus:outline-none" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}>
                <option value="">All channels</option>
                {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Minimum account age (minutes)</label>
              <input type="number" min={0} value={form.min_account_age_minutes} onChange={(e) => updateForm("min_account_age_minutes", Number(e.target.value))} className="w-full px-3 py-1.5 rounded text-sm focus:outline-none" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }} />
            </div>
          </div>

          {/* Actions */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-text-secondary)' }}>Actions</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.block_message} onChange={(e) => updateForm("block_message", e.target.checked)} className="rounded" />
                <span className="text-sm text-white">Block message</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.quarantine_message} onChange={(e) => updateForm("quarantine_message", e.target.checked)} className="rounded" />
                <span className="text-sm text-white">Quarantine message</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.timeout_member} onChange={(e) => updateForm("timeout_member", e.target.checked)} className="rounded" />
                <span className="text-sm text-white">Timeout member</span>
              </label>
              {form.timeout_member && (
                <div className="ml-6 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={2_419_200}
                    value={form.timeout_duration}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      updateForm("timeout_duration", Math.min(Math.max(1, v), 2_419_200))
                    }}
                    className="w-20 px-2 py-1 rounded text-sm focus:outline-none"
                    style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>seconds (max 28 days)</span>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.warn_member} onChange={(e) => updateForm("warn_member", e.target.checked)} className="rounded" />
                <span className="text-sm text-white">Warn member</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.alert_channel} onChange={(e) => updateForm("alert_channel", e.target.checked)} className="rounded" />
                <span className="text-sm text-white">Alert mod channel</span>
              </label>
              {form.alert_channel && (
                <div className="ml-6">
                  <select
                    value={form.alert_channel_id}
                    onChange={(e) => updateForm("alert_channel_id", e.target.value)}
                    className="w-full px-2 py-1 rounded text-sm focus:outline-none"
                    style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>#{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded p-3" style={{ background: 'var(--theme-bg-tertiary)', border: '1px solid var(--theme-surface-elevated)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>Sample message evaluator</p>
            <input
              value={sampleMessage}
              onChange={(e) => setSampleMessage(e.target.value)}
              placeholder="Type a sample message to test this rule"
              className="w-full px-3 py-1.5 rounded text-sm focus:outline-none"
              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-surface-elevated)' }}
            />
            <p className="text-xs" style={{ color: sampleMessage ? (sampleViolation ? 'var(--theme-warning)' : 'var(--theme-positive)') : 'var(--theme-text-muted)' }}>
              {sampleMessage
                ? sampleViolation
                  ? `Triggered: ${sampleViolation.reason}`
                  : 'No trigger match.'
                : 'Enter a sample message for live evaluation.'}
            </p>
            <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              Conflict resolution: lower priority value executes first; block/quarantine overrides warn-only outcomes.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} style={{ background: 'var(--theme-accent)' }}>
              {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {editingId === "new" ? "Create" : "Update"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} style={{ color: 'var(--theme-text-secondary)' }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)' }}>
          <DialogHeader>
            <DialogTitle className="text-white">Delete AutoMod rule?</DialogTitle>
            <DialogDescription style={{ color: 'var(--theme-text-secondary)' }}>
              This action can&apos;t be undone. The rule <span className="font-semibold text-white">{deleteTarget?.name}</span> will stop moderating messages immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return
                handleDelete(deleteTarget.id)
              }}
            >
              Delete rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Invites Manager ──────────────────────────────────────────────────────────

interface InviteEntry {
  code: string
  server_id: string
  channel_id: string | null
  created_by: string | null
  max_uses: number | null
  uses: number
  expires_at: string | null
  temporary: boolean
  created_at: string
  creator?: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null
}

const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "30 minutes", hours: 0.5 },
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "Never", hours: null },
]

function formatRelativeTime(dateStr: string): string {
  const ms = new Date(dateStr).getTime() - Date.now()
  if (ms <= 0) return "Expired"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h`
  const totalDays = Math.floor(totalHours / 24)
  return `${totalDays}d`
}

/** Full invite management panel with table, create dialog, and revoke actions. */
function InvitesManager({ serverId, isOwner }: { serverId: string; isOwner: boolean }) {
  const { toast } = useToast()
  const [invites, setInvites] = useState<InviteEntry[]>([])
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [showCreateInvite, setShowCreateInvite] = useState(false)
  const [creating, setCreating] = useState(false)
  const [expiryHours, setExpiryHours] = useState<number | null>(24)
  const [maxUses, setMaxUses] = useState<string>("")

  useEffect(() => {
    setLoadingInvites(true)
    fetch(`/api/servers/${serverId}/invites`)
      .then((r) => r.json())
      .then((data) => {
        setInvites(Array.isArray(data) ? data : [])
        setLoadingInvites(false)
      })
      .catch(() => setLoadingInvites(false))
  }, [serverId])

  async function handleCreateInvite() {
    setCreating(true)
    try {
      const body: Record<string, unknown> = {}
      if (expiryHours !== null) body.expiresIn = expiryHours
      const parsedMaxUses = parseInt(maxUses)
      if (!isNaN(parsedMaxUses) && parsedMaxUses > 0) body.maxUses = parsedMaxUses

      const res = await fetch(`/api/servers/${serverId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to create invite")
      }

      const invite = await res.json()
      setInvites((prev) => [invite, ...prev])
      setShowCreateInvite(false)
      setExpiryHours(24)
      setMaxUses("")
      toast({ title: "Invite created!" })

      // Copy to clipboard automatically
      try {
        await navigator.clipboard.writeText(invite.code)
        toast({ title: "Invite code copied to clipboard!" })
      } catch {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ServerSettingsModal] clipboard write failed", { action: "copyNewInvite", serverId })
        }
        toast({ variant: "destructive", title: "Copy failed" })
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to create invite", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(code: string) {
    try {
      const res = await fetch(`/api/servers/${serverId}/invites?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to revoke invite")
      }

      setInvites((prev) => prev.filter((inv) => inv.code !== code))
      toast({ title: "Invite revoked" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to revoke invite", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code)
      toast({ title: "Invite code copied!" })
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ServerSettingsModal] clipboard write failed", { action: "copyCode", serverId })
      }
      toast({ variant: "destructive", title: "Copy failed" })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-sm">Custom Invites</p>
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            Create invite links with custom expiry and usage limits.
          </p>
        </div>
        <button
          onClick={() => setShowCreateInvite(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium text-white"
          style={{ background: 'var(--theme-accent)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Create Invite
        </button>
      </div>

      {/* Invites table */}
      {loadingInvites ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : invites.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          No custom invites yet.
        </div>
      ) : (
        <div className="space-y-1">
          {invites.map((inv) => {
            const isExpired = inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()
            const isMaxed = inv.max_uses !== null && inv.uses >= inv.max_uses
            return (
              <div
                key={inv.code}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{ background: 'var(--theme-bg-secondary)', opacity: isExpired || isMaxed ? 0.5 : 1 }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyCode(inv.code)}
                      className="font-mono text-sm font-semibold text-white hover:underline cursor-pointer"
                      title="Click to copy"
                    >
                      {inv.code}
                    </button>
                    <button
                      onClick={() => copyCode(inv.code)}
                      className="p-0.5 rounded hover:bg-white/10"
                      style={{ color: 'var(--theme-text-muted)' }}
                      title="Copy invite code"
                      aria-label="Copy invite code"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                    {inv.creator && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {inv.creator.display_name || inv.creator.username}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {inv.expires_at
                        ? (isExpired ? "Expired" : `Expires in ${formatRelativeTime(inv.expires_at)}`)
                        : "Never expires"}
                    </span>
                    <span>
                      {inv.uses}{inv.max_uses !== null ? `/${inv.max_uses}` : ""} uses
                    </span>
                  </div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleRevoke(inv.code)}
                    className="p-1.5 rounded hover:bg-red-500/20 transition-colors flex-shrink-0"
                    style={{ color: 'var(--theme-text-faint)' }}
                    title="Revoke invite"
                    aria-label="Revoke invite"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create invite dialog */}
      <Dialog open={showCreateInvite} onOpenChange={setShowCreateInvite}>
        <DialogContent style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)', maxWidth: '420px' }}>
          <DialogHeader>
            <DialogTitle className="text-white">Create Invite</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                Expire After
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {EXPIRY_OPTIONS.map(({ label, hours }) => (
                  <button
                    key={label}
                    onClick={() => setExpiryHours(hours)}
                    className="py-1.5 px-2 rounded text-sm font-medium transition-colors"
                    style={{
                      background: expiryHours === hours ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)',
                      color: expiryHours === hours ? 'white' : 'var(--theme-text-muted)',
                      border: `1px solid ${expiryHours === hours ? 'var(--theme-accent)' : 'transparent'}`,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-max-uses" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
                Max Number of Uses
              </Label>
              <Input
                id="invite-max-uses"
                type="number"
                min={0}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="No limit"
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
              />
              <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                Leave empty for unlimited uses.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setShowCreateInvite(false)}
                className="flex-1"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateInvite}
                disabled={creating}
                className="flex-1"
                style={{ background: 'var(--theme-accent)' }}
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Invite
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
