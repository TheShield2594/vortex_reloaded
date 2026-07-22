import { Suspense } from "react"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"
import { createServerSupabaseClient, getAuthUser } from "@/lib/supabase/server"
import { AppProvider } from "@/components/layout/app-provider"
import { ChannelsShell } from "@/components/layout/channels-shell"
import { MobileBottomTabBar } from "@/components/layout/mobile-bottom-tab-bar"
import { OnboardingGate } from "@/components/onboarding/onboarding-gate"
import type { ServerRow } from "@/types/database"
import { perfTimer } from "@/lib/perf"

/** Skeleton shown while the channels layout streams server data. */
function ChannelsLayoutSkeleton(): React.ReactElement {
  return (
    <div className="flex h-dvh w-full">
      {/* Server sidebar skeleton */}
      <div className="w-[72px] flex-shrink-0 flex flex-col items-center gap-2 py-3" style={{ background: "var(--theme-bg-tertiary)" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-12 h-12 rounded-full animate-pulse" style={{ background: "var(--theme-bg-secondary)" }} />
        ))}
      </div>
      {/* Channel sidebar skeleton */}
      <div className="w-60 flex-shrink-0 flex flex-col gap-2 p-3" style={{ background: "var(--theme-bg-secondary)" }}>
        <div className="h-8 w-3/4 rounded animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 rounded animate-pulse" style={{ background: "var(--theme-bg-tertiary)", width: `${60 + Math.random() * 30}%` }} />
        ))}
      </div>
      {/* Main content skeleton */}
      <div className="flex-1" style={{ background: "var(--theme-bg-primary)" }} />
    </div>
  )
}

/** Async inner component that fetches auth + profile + servers then renders the shell. */
async function ChannelsLayoutContent({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const rootTimer = perfTimer("channels-layout total")
  try {
    const authTimer = perfTimer("channels-layout auth")
    const [supabase, { data: { user }, error }] = await Promise.all([
      createServerSupabaseClient(),
      getAuthUser(),
    ])
    authTimer.end()

    if (error || !user) {
      redirect("/login")
    }

    // Fetch user profile and server memberships in parallel
    const profileTimer = perfTimer("channels-layout profile+memberships")
    const [{ data: profile, error: profileError }, { data: serverMembers, error: serverMembersError }] = await Promise.all([
      supabase.from("users").select("*").eq("id", user.id).single(),
      supabase.from("server_members").select("server_id, joined_at").eq("user_id", user.id).order("joined_at", { ascending: true }),
    ])
    profileTimer.end()

    if (profileError || !profile) redirect("/login")

    if (serverMembersError) {
      console.error("Failed to load server memberships:", serverMembersError.message)
    }

    const membershipIds = (serverMembers ?? []).map((membership) => membership.server_id)
    const serverListTimer = perfTimer("channels-layout server-list")
    const { data: serverRows, error: serversError } = membershipIds.length
      ? await supabase.from("servers").select("*").in("id", membershipIds)
      : { data: [], error: null }
    serverListTimer.end()

    if (serversError) {
      console.error("Failed to load servers:", serversError.message)
    }

    const serversById = new Map((serverRows ?? []).map((server) => [server.id, server]))
    const servers = membershipIds
      .map((serverId) => serversById.get(serverId))
      .filter((server): server is ServerRow => Boolean(server))

    rootTimer.end()

    // Show onboarding for first-time users (no servers, haven't completed onboarding)
    const needsOnboarding = servers.length === 0 && !profile.onboarding_completed_at

    return (
      <AppProvider user={profile} servers={servers}>
        {needsOnboarding ? (
          <OnboardingGate username={profile.display_name || profile.username} userId={profile.id} />
        ) : (
          <>
            <ChannelsShell>
              {children}
            </ChannelsShell>
            <MobileBottomTabBar />
          </>
        )}
      </AppProvider>
    )
  } catch (err) {
    rootTimer.end()
    console.error("[channels/layout] failed to load layout:", err)
    throw err
  }
}

/** Root layout for all /channels routes — wraps the async content in a Suspense boundary for progressive SSR streaming. */
export default function ChannelsLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Suspense fallback={<ChannelsLayoutSkeleton />}>
      <ChannelsLayoutContent>{children}</ChannelsLayoutContent>
    </Suspense>
  )
}
