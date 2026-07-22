"use client"

import { lazy, Suspense } from "react"
import { Activity, BookOpen, Bot, Eye, Flag, Heart, Palette, Shield, ShieldCheck, Zap } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AutoModTab, EmojisTab, ModerationTab, ScreeningTab, WebhooksTab } from "@/components/modals/server-settings-modal"

// Lazy-load heavy tab components that aren't needed on initial render
const RoleManager = lazy(() => import("@/components/roles/role-manager").then((m) => ({ default: m.RoleManager })))
const TemplateManager = lazy(() => import("@/components/modals/template-manager").then((m) => ({ default: m.TemplateManager })))
const AppsTab = lazy(() => import("@/components/settings/apps-tab").then((m) => ({ default: m.AppsTab })))
const ReportsTab = lazy(() => import("@/components/settings/reports-tab").then((m) => ({ default: m.ReportsTab })))
const AdminActivityTimeline = lazy(() => import("@/components/admin/admin-activity-timeline").then((m) => ({ default: m.AdminActivityTimeline })))
const PermissionSandbox = lazy(() => import("@/components/admin/permission-sandbox").then((m) => ({ default: m.PermissionSandbox })))
const AuditLogPage = lazy(() => import("@/components/admin/audit-log-page").then((m) => ({ default: m.AuditLogPage })))
const CommunityHealthDashboard = lazy(() => import("@/components/admin/community-health-dashboard").then((m) => ({ default: m.CommunityHealthDashboard })))
const ServerRecommendedTheme = lazy(() => import("@/components/settings/theme-identity-section").then((m) => ({ default: m.ServerRecommendedTheme })))
const AiSettingsTab = lazy(() => import("@/components/settings/ai-settings-tab").then((m) => ({ default: m.AiSettingsTab })))

interface Channel {
  id: string
  name: string
}

interface Props {
  serverId: string
  serverName: string
  isOwner: boolean
  channels: Channel[]
}

function TabLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-pulse text-sm" style={{ color: "var(--theme-text-muted)" }}>Loading...</div>
    </div>
  )
}

export function ServerSettingsAdmin({ serverId, serverName, isOwner, channels }: Props) {
  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ background: "var(--theme-bg-tertiary)" }}>
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-semibold text-white">Server Settings</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--theme-text-muted)" }}>{serverName}</p>

        <Tabs defaultValue="roles" className="mt-6 flex flex-col md:flex-row gap-4 md:gap-6">
          <div className="w-full md:w-56 flex-shrink-0">
            <TabsList className="flex h-auto w-full flex-row md:flex-col gap-1 bg-transparent p-0 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
              <TabsTrigger value="roles" className="w-full justify-start whitespace-nowrap">Roles</TabsTrigger>
              <TabsTrigger value="emojis" className="w-full justify-start whitespace-nowrap">Emoji</TabsTrigger>
              <TabsTrigger value="webhooks" className="w-full justify-start whitespace-nowrap">Webhooks</TabsTrigger>
              <TabsTrigger value="apps" className="w-full justify-start whitespace-nowrap">Apps</TabsTrigger>
              <div className="mt-2 mb-1 px-3 text-xs font-semibold uppercase tracking-wider hidden md:block" style={{ color: "var(--theme-text-muted)" }}>
                Moderation
              </div>
              <TabsTrigger value="moderation" className="w-full justify-start whitespace-nowrap">
                <Shield className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Settings
              </TabsTrigger>
              <TabsTrigger value="screening" className="w-full justify-start whitespace-nowrap">
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Screening
              </TabsTrigger>
              <TabsTrigger value="automod" className="w-full justify-start whitespace-nowrap">
                <Zap className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                AutoMod
              </TabsTrigger>
              <TabsTrigger value="reports" className="w-full justify-start whitespace-nowrap">
                <Flag className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Reports
              </TabsTrigger>
              <TabsTrigger value="templates" className="w-full justify-start whitespace-nowrap">Templates</TabsTrigger>
              <div className="mt-2 mb-1 px-3 text-xs font-semibold uppercase tracking-wider hidden md:block" style={{ color: "var(--theme-text-muted)" }}>
                Safety Tools
              </div>
              <TabsTrigger value="audit-log" className="w-full justify-start whitespace-nowrap">
                <BookOpen className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Audit Log
              </TabsTrigger>
              <TabsTrigger value="admin-activity" className="w-full justify-start whitespace-nowrap">
                <Activity className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Activity
              </TabsTrigger>
              <TabsTrigger value="permission-sandbox" className="w-full justify-start whitespace-nowrap">
                <Eye className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Perms
              </TabsTrigger>
              <div className="mt-2 mb-1 px-3 text-xs font-semibold uppercase tracking-wider hidden md:block" style={{ color: "var(--theme-text-muted)" }}>
                Insights
              </div>
              <TabsTrigger value="community-health" className="w-full justify-start whitespace-nowrap">
                <Heart className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Health
              </TabsTrigger>
              <TabsTrigger value="server-theme" className="w-full justify-start whitespace-nowrap">
                <Palette className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                Theme
              </TabsTrigger>
              <TabsTrigger value="ai-settings" className="w-full justify-start whitespace-nowrap">
                <Bot className="mr-1.5 h-3.5 w-3.5 hidden md:block" />
                AI
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-w-0 flex-1 rounded-md p-4" style={{ background: "var(--theme-bg-primary)" }}>
            <Suspense fallback={<TabLoadingFallback />}>
              <TabsContent value="roles" className="mt-0">
                <RoleManager serverId={serverId} isOwner={isOwner} />
              </TabsContent>
              <TabsContent value="emojis" className="mt-0">
                <EmojisTab serverId={serverId} />
              </TabsContent>
              <TabsContent value="webhooks" className="mt-0">
                <WebhooksTab serverId={serverId} channels={channels} open />
              </TabsContent>
              <TabsContent value="apps" className="mt-0">
                <AppsTab serverId={serverId} canManageApps={isOwner} />
              </TabsContent>
              <TabsContent value="moderation" className="mt-0">
                <ModerationTab serverId={serverId} open />
              </TabsContent>
              <TabsContent value="screening" className="mt-0">
                <ScreeningTab serverId={serverId} open />
              </TabsContent>
              <TabsContent value="automod" className="mt-0">
                <AutoModTab serverId={serverId} channels={channels} open />
              </TabsContent>
              <TabsContent value="reports" className="mt-0">
                <ReportsTab serverId={serverId} />
              </TabsContent>
              <TabsContent value="templates" className="mt-0">
                {isOwner ? <TemplateManager serverId={serverId} /> : <p style={{ color: "var(--theme-text-secondary)" }}>Only the owner can import/export templates.</p>}
              </TabsContent>
              <TabsContent value="audit-log" className="mt-0">
                <AuditLogPage serverId={serverId} />
              </TabsContent>
              <TabsContent value="admin-activity" className="mt-0">
                <AdminActivityTimeline serverId={serverId} />
              </TabsContent>
              <TabsContent value="permission-sandbox" className="mt-0">
                <PermissionSandbox serverId={serverId} channels={channels} />
              </TabsContent>
              <TabsContent value="community-health" className="mt-0">
                <CommunityHealthDashboard serverId={serverId} />
              </TabsContent>
              <TabsContent value="server-theme" className="mt-0">
                <ServerRecommendedTheme serverId={serverId} />
              </TabsContent>
              <TabsContent value="ai-settings" className="mt-0">
                {isOwner ? <AiSettingsTab serverId={serverId} /> : <p style={{ color: "var(--theme-text-secondary)" }}>Only the server owner can manage AI settings.</p>}
              </TabsContent>
            </Suspense>
          </div>
        </Tabs>
      </div>
    </main>
  )
}
