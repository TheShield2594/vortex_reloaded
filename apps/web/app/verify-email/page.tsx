"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, MailCheck } from "lucide-react"
import { VortexLogo } from "@/components/ui/vortex-logo"

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("")
  const [manualEmail, setManualEmail] = useState("")
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const [resending, setResending] = useState(false)
  const supabase = createClientSupabaseClient()

  // Prefer the authenticated user's email (authoritative), fall back to
  // sessionStorage (set by login page) for users without a session.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setEmail(data.user.email)
        // Clear stale sessionStorage if present
        try { sessionStorage.removeItem("verifyEmail") } catch {}
        setLoading(false)
        return
      }
      // No session — try sessionStorage (set moments before redirect)
      let stored = ""
      try {
        stored = sessionStorage.getItem("verifyEmail") || ""
        if (stored) sessionStorage.removeItem("verifyEmail")
      } catch {}
      if (stored) setEmail(stored)
      setLoading(false)
    }).catch(() => {
      // Network error — try sessionStorage as last resort
      let stored = ""
      try {
        stored = sessionStorage.getItem("verifyEmail") || ""
        if (stored) sessionStorage.removeItem("verifyEmail")
      } catch {}
      if (stored) setEmail(stored)
      setLoading(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleResend() {
    const target = email || manualEmail.trim()
    if (!target) {
      toast({ variant: "destructive", title: "Please enter your email address" })
      return
    }
    setResending(true)
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: target,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
      toast({ title: "Verification email sent!", description: `Check ${target} for a new verification link.` })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred"
      toast({ variant: "destructive", title: "Failed to resend", description: message })
    } finally {
      setResending(false)
    }
  }

  return (
    <div
      className="relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden overflow-y-auto px-6 py-8"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--theme-accent) 10%, transparent), transparent 70%), var(--theme-bg-tertiary)",
      }}
    >
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl vortex-glow"
        style={{ background: "var(--theme-accent)", opacity: 0.18 }}
      />
      <div className="relative w-full max-w-md">
        <div className="auth-surface rounded-2xl border p-8 shadow-2xl backdrop-blur">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-4">
              <VortexLogo size={48} />
            </div>
            <div className="mb-4 flex justify-center">
              <MailCheck className="h-12 w-12" style={{ color: "var(--theme-accent)" }} />
            </div>
            <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
              Check your email
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
              {email ? (
                <>
                  We sent a verification link to{" "}
                  <span className="font-medium" style={{ color: "var(--theme-text-primary)" }}>{email}</span>.
                  Click the link to activate your account.
                </>
              ) : (
                "A verification link was sent to your email address. Click the link to activate your account."
              )}
            </p>
          </div>

          <div
            className="rounded-lg border p-4 text-sm mb-6"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: "var(--theme-bg-tertiary)",
              color: "var(--theme-text-secondary)",
            }}
          >
            <p className="mb-2 font-medium" style={{ color: "var(--theme-text-primary)" }}>
              Didn&apos;t receive it?
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Check your spam or junk folder</li>
              <li>Make sure you entered the correct email</li>
              <li>The link expires after 24 hours</li>
            </ul>
          </div>

          {!loading && !email && (
            <input
              id="manual-email"
              type="email"
              aria-label="Email address for verification"
              placeholder="Enter your email address"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              className="w-full h-11 rounded-lg border px-3 text-sm mb-3 outline-none focus:ring-2"
              style={{
                borderColor: "rgba(255,255,255,0.12)",
                background: "var(--theme-bg-tertiary)",
                color: "var(--theme-text-primary)",
              }}
            />
          )}
          {!loading && (
            <Button
              type="button"
              onClick={handleResend}
              disabled={resending || (!email && !manualEmail.trim())}
              className="auth-btn-accent w-full h-11 font-medium border-0"
            >
              {resending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Resend verification email
            </Button>
          )}

          <p className="text-center text-sm mt-6" style={{ color: "var(--theme-text-secondary)" }}>
            Already verified?{" "}
            <Link href="/login" className="hover:underline" style={{ color: "var(--theme-link)" }}>
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
