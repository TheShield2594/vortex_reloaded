"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { authClient } from "@/lib/auth/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, CheckCircle2, XCircle } from "lucide-react"
import { VortexLogo } from "@/components/ui/vortex-logo"

function friendlySignupError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes("already exists") || lower.includes("already registered") || lower.includes("already taken"))
    return "An account with this email or username already exists. Try logging in instead."
  if (lower.includes("password") && (lower.includes("strength") || lower.includes("weak") || lower.includes("short")))
    return "Password is too weak. Use at least 12 characters with a mix of letters, numbers, and symbols."
  if (lower.includes("rate") || lower.includes("too many"))
    return "Too many signup attempts. Please wait a moment and try again."
  if (lower.includes("invalid") && lower.includes("email"))
    return "Please enter a valid email address."
  if (lower.includes("invite"))
    return "That invite code isn't valid. Double-check it or ask whoever invited you for a new one."
  return message
}

type InviteStatus = { state: "idle" | "checking" | "valid" | "invalid"; message?: string }

/** Debounced GET /api/invites/validate — pure UX feedback; the real gate is server-side at signup time. */
function useInviteCodeCheck(code: string): InviteStatus {
  const [status, setStatus] = useState<InviteStatus>({ state: "idle" })

  useEffect(() => {
    const trimmed = code.trim()
    if (!trimmed) {
      setStatus({ state: "idle" })
      return
    }
    setStatus({ state: "checking" })
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/invites/validate?code=${encodeURIComponent(trimmed)}`)
        const data = await res.json()
        if (data.valid) {
          setStatus({ state: "valid" })
        } else {
          const reasons: Record<string, string> = {
            not_found: "Invite code not found",
            revoked: "This invite has been revoked",
            expired: "This invite has expired",
            exhausted: "This invite has already been used",
          }
          setStatus({ state: "invalid", message: reasons[data.reason] ?? "Invalid invite code" })
        }
      } catch {
        setStatus({ state: "idle" })
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [code])

  return status
}

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    email: "",
    username: "",
    displayName: "",
    password: "",
    confirmPassword: "",
    // Prefilled from a shared invite link/QR (?invite=CODE) — see
    // /settings/invites, which generates both.
    inviteCode: searchParams.get("invite") ?? "",
  })
  const inviteStatus = useInviteCodeCheck(form.inviteCode)

  async function handleRegister(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    setFormError(null)

    if (!form.inviteCode.trim()) {
      toast({ variant: "destructive", title: "Invite code required", description: "Vortex is invite-only — ask an existing member for a code." })
      return
    }

    if (form.password !== form.confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match" })
      return
    }

    if (form.password.length < 12) {
      toast({ variant: "destructive", title: "Password must be at least 12 characters" })
      return
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,32}$/
    if (!usernameRegex.test(form.username)) {
      toast({
        variant: "destructive",
        title: "Invalid username",
        description: "Username must be 3-32 characters, letters, numbers, and underscores only",
      })
      return
    }

    setLoading(true)
    try {
      // inviteCode isn't a declared Better Auth field (it's consumed and
      // discarded in databaseHooks.user.create.before, never persisted to
      // the users table) — going through this intermediately-typed `payload`
      // instead of an inline object literal avoids an excess-property type
      // error while still putting the field on the wire, since Better
      // Auth's client just JSON-serializes whatever it's given.
      const payload = {
        email: form.email,
        password: form.password,
        // `name` is Better Auth's canonical field, mapped to the `username`
        // DB column (see user.fields in lib/auth/better-auth.ts) — this is
        // this app's username, not a display name.
        name: form.username.toLowerCase(),
        displayName: form.displayName || form.username,
        inviteCode: form.inviteCode.trim(),
      }
      const { error } = await authClient.signUp.email(payload)
      if (error) throw new Error(error.message || "Registration failed")

      toast({
        title: "Account created!",
        description: "Check your email to verify your account, then log in.",
      })
      router.push("/login?registered=true")
    } catch (error: unknown) {
      console.error("[register] signup failed:", error instanceof Error ? error.message : error)
      const message = error instanceof Error ? error.message : "An unexpected error occurred. Please try again."
      const friendly = friendlySignupError(message)
      setFormError(friendly)
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: friendly,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-surface rounded-2xl border p-8 shadow-2xl backdrop-blur">
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <VortexLogo size={48} />
        </div>
        <h1 className="text-2xl font-bold font-display" style={{ color: 'var(--theme-text-bright)' }}>Create an account</h1>
        <p style={{ color: 'var(--theme-text-secondary)' }} className="text-sm mt-1">
          Join Vortex — then add a passkey in Security settings for passkey-first login.
        </p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="register-invite-code" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
            Invite Code <span style={{ color: 'var(--theme-danger)' }}>*</span>
          </Label>
          <div className="relative">
            <Input
              id="register-invite-code"
              type="text"
              value={form.inviteCode}
              onChange={(e) => setForm({ ...form, inviteCode: e.target.value.toUpperCase() })}
              placeholder="ABCD1234"
              required
              className="auth-input h-10 border pr-9 uppercase tracking-wider"
            />
            {inviteStatus.state === "valid" && (
              <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-success, #22c55e)' }} />
            )}
            {inviteStatus.state === "invalid" && (
              <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-danger)' }} />
            )}
            {inviteStatus.state === "checking" && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: 'var(--theme-text-secondary)' }} />
            )}
          </div>
          {inviteStatus.state === "invalid" && (
            <p className="text-xs" style={{ color: 'var(--theme-danger)' }}>{inviteStatus.message}</p>
          )}
          <p className="text-xs" style={{ color: 'var(--theme-text-faint)' }}>
            Vortex is invite-only. Ask an existing member for a code, or use a shared invite link.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-email" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
            Email <span style={{ color: 'var(--theme-danger)' }}>*</span>
          </Label>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className="auth-input h-10 border"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-username" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
            Username <span style={{ color: 'var(--theme-danger)' }}>*</span>
          </Label>
          <Input
            id="register-username"
            type="text"
            autoComplete="username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="cooluser123"
            required
            className="auth-input h-10 border"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-display-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
            Display Name
          </Label>
          <Input
            id="register-display-name"
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="How others see you"
            className="auth-input h-10 border"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-password" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
            Password <span style={{ color: 'var(--theme-danger)' }}>*</span>
          </Label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            className="auth-input h-10 border"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-confirm-password" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
            Confirm Password <span style={{ color: 'var(--theme-danger)' }}>*</span>
          </Label>
          <Input
            id="register-confirm-password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            required
            className="auth-input h-10 border"
          />
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-md px-3 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--theme-danger-bg, rgba(255,0,0,0.1))', color: 'var(--theme-danger)' }}
          >
            {formError}
          </div>
        )}

        <Button
          type="submit"
          disabled={loading || inviteStatus.state === "invalid"}
          className="auth-btn-accent w-full h-11 font-medium mt-2 border-0"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </form>

      <p className="text-center text-sm mt-6" style={{ color: 'var(--theme-text-secondary)' }}>
        Already have an account?{" "}
        <Link href="/login" className="hover:underline" style={{ color: 'var(--theme-link)' }}>
          Log In
        </Link>
      </p>

      <p className="text-center text-xs mt-4" style={{ color: 'var(--theme-text-faint)' }}>
        By registering, you agree to Vortex&apos;s{" "}
        <Link href="/terms" className="underline" style={{ color: "var(--theme-accent)" }}>Terms of Service</Link>
        {" "}and{" "}
        <Link href="/privacy" className="underline" style={{ color: "var(--theme-accent)" }}>Privacy Policy</Link>
        . Keep password/magic link recovery enabled until you add a backup passkey on another device.
      </p>
    </div>
  )
}
