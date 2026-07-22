"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldCheck } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { VortexLogo } from "@/components/ui/vortex-logo"

export const dynamic = "force-dynamic"

/** Handles Supabase password-reset redirect links (type=recovery). */
export default function UpdatePasswordPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  // Verify that a recovery session actually exists before showing the form.
  // Without this guard, anyone who navigates directly to /update-password would
  // see the form and get a confusing "not authenticated" error on submit.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        toast({
          variant: "destructive",
          title: "Invalid or expired link",
          description: "Please request a new password reset.",
        })
        router.push("/login")
      } else {
        setCheckingSession(false)
      }
    })
  }, [supabase, router, toast])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 12) {
      toast({ variant: "destructive", title: "Password too short", description: "Minimum 12 characters." })
      return
    }
    if (password !== confirm) {
      toast({ variant: "destructive", title: "Passwords don't match" })
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast({ title: "Password updated!", description: "You can now sign in with your new password." })
      router.push("/login")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      toast({ variant: "destructive", title: "Update failed", description: message })
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) return null

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-6"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--theme-accent) 10%, transparent), transparent 70%), var(--theme-bg-tertiary)",
      }}
    >
      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl vortex-glow"
        style={{ background: "var(--theme-accent)", opacity: 0.18 }}
      />
      <div className="relative w-full max-w-md">
        <div className="auth-surface rounded-2xl border p-8 shadow-2xl backdrop-blur">
          <div className="mb-8 text-center">
            <div className="mb-4 flex justify-center">
              <VortexLogo size={48} />
            </div>
            <div className="mb-3 flex justify-center">
              <div
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  border: "1px solid color-mix(in srgb, var(--theme-accent) 40%, transparent)",
                  background: "color-mix(in srgb, var(--theme-accent) 10%, transparent)",
                  color: "color-mix(in srgb, var(--theme-accent) 80%, white)",
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Set new password
              </div>
            </div>
            <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
              Choose a new password
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
              Must be at least 12 characters.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="new-password"
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--theme-text-secondary)" }}
              >
                New Password <span style={{ color: "var(--theme-danger)" }}>*</span>
              </Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                minLength={12}
                className="auth-input h-10 border"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="confirm-password"
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--theme-text-secondary)" }}
              >
                Confirm Password <span style={{ color: "var(--theme-danger)" }}>*</span>
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="auth-input h-10 border"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || !password || !confirm}
              className="auth-btn-accent h-11 w-full border-0 font-medium transition-opacity hover:opacity-90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update Password
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}