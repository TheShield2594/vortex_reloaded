"use client"

import { useRouter } from "next/navigation"
import { UserPlus, MessageCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { VortexLogo } from "@/components/ui/vortex-logo"

interface OnboardingFlowProps {
  username: string
  userId: string
}

/** Minimal first-run welcome screen for the DM/group-chat-only product — points new users at Friends. */
export function OnboardingFlow({ username }: OnboardingFlowProps) {
  const router = useRouter()
  const { toast } = useToast()

  async function markOnboardingComplete(): Promise<void> {
    const res = await fetch("/api/onboarding/complete", { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Failed to complete onboarding" }))
      throw new Error(body.error || "Failed to complete onboarding")
    }
  }

  async function goToFriends(): Promise<void> {
    try {
      await markOnboardingComplete()
      router.push("/channels/friends")
      router.refresh()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Couldn't finish onboarding", description: message })
    }
  }

  async function skipOnboarding(): Promise<void> {
    try {
      await markOnboardingComplete()
      router.push("/channels/me")
      router.refresh()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ variant: "destructive", title: "Couldn't finish onboarding", description: message })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: "radial-gradient(ellipse at 50% 20%, color-mix(in srgb, var(--theme-accent) 30%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-lg mx-4 text-center space-y-6 animate-in fade-in duration-300">
        <div className="flex justify-center mb-2">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--theme-accent) 20%, var(--theme-bg-secondary))" }}
          >
            <VortexLogo size={40} />
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome to VortexChat{username ? `, ${username}` : ""}!
          </h1>
          <p className="text-base" style={{ color: "var(--theme-text-secondary)" }}>
            Add a few friends to start chatting, or hop on a voice call once you&apos;re connected.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <Button
            onClick={goToFriends}
            className="w-full h-14 text-base font-semibold rounded-xl"
            style={{ background: "var(--theme-accent)" }}
          >
            <UserPlus className="w-5 h-5 mr-2" />
            Find People to Chat With
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          <Button
            variant="outline"
            onClick={skipOnboarding}
            className="w-full h-14 text-base font-semibold rounded-xl border-2"
            style={{
              borderColor: "var(--theme-surface-elevated)",
              background: "var(--theme-bg-secondary)",
              color: "var(--theme-text-primary)",
            }}
          >
            <MessageCircle className="w-5 h-5 mr-2" />
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  )
}
