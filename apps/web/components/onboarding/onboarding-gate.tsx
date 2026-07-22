"use client"

import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"

const OnboardingFlow = lazy(() =>
  import("./onboarding-flow").then((m) => ({ default: m.OnboardingFlow }))
)

function OnboardingFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--theme-accent)" }} />
    </div>
  )
}

interface OnboardingGateProps {
  username: string
  userId: string
}

/** Client boundary that lazy-loads the full onboarding flow. Used by the channels layout when onboarding is needed. */
export function OnboardingGate({ username, userId }: OnboardingGateProps) {
  return (
    <Suspense fallback={<OnboardingFallback />}>
      <OnboardingFlow username={username} userId={userId} />
    </Suspense>
  )
}
