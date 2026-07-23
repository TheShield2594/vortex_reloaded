import { Suspense } from "react"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
import { createDb, users } from "@vortex/db"
import { getAuthUser } from "@/lib/auth/better-auth"
import { toSnakeCase } from "@/lib/utils/case"
import type { UserRow } from "@/types/database"
import { AppProvider } from "@/components/layout/app-provider"
import { ChannelsShell } from "@/components/layout/channels-shell"
import { MobileBottomTabBar } from "@/components/layout/mobile-bottom-tab-bar"
import { OnboardingGate } from "@/components/onboarding/onboarding-gate"
import { perfTimer } from "@/lib/perf"

const db = createDb()

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

/** Async inner component that fetches auth + profile then renders the shell. */
async function ChannelsLayoutContent({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const rootTimer = perfTimer("channels-layout total")
  try {
    const authTimer = perfTimer("channels-layout auth")
    const { data: { user }, error } = await getAuthUser()
    authTimer.end()

    if (error || !user) {
      redirect("/login")
    }

    // Fetch user profile
    const profileTimer = perfTimer("channels-layout profile")
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    profileTimer.end()

    if (!row) redirect("/login")
    const profile = toSnakeCase<UserRow>(row)

    rootTimer.end()

    // Show onboarding for first-time users (haven't completed onboarding). There is no
    // UI path left that can populate server membership, so this no longer needs to check it.
    const needsOnboarding = !profile.onboarding_completed_at

    return (
      <AppProvider user={profile}>
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
