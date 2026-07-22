"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, ShieldCheck, Sparkles, KeyRound, Eye, EyeOff, Info } from "lucide-react"
import { startPasskeyLogin, supportsPasskeys } from "@/lib/auth/passkeys-client"
import { VortexLogo } from "@/components/ui/vortex-logo"

type LoginStep = "credentials" | "mfa-challenge" | "recovery-code"


// Reusable accent badge — variant drives which CSS variable is used for color
function AccentBadge({
  children,
  variant = "accent",
}: {
  children: React.ReactNode
  variant?: "accent" | "warning"
}) {
  const colorVar = variant === "warning" ? "--theme-warning" : "--theme-accent"
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
      style={{
        border: `1px solid color-mix(in srgb, var(${colorVar}) 40%, transparent)`,
        background: `color-mix(in srgb, var(${colorVar}) 10%, transparent)`,
        color: `color-mix(in srgb, var(${colorVar}) 80%, white)`,
      }}
    >
      {children}
    </div>
  )
}

// ── OTP Input — 6 individual digit boxes ────────────────────────────────────
function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, " ").slice(0, 6).split("")

  // Focus first box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleChange = useCallback(
    (index: number, char: string) => {
      if (!/^\d?$/.test(char)) return
      const next = digits.slice()
      next[index] = char
      const joined = next.join("").replace(/ /g, "")
      onChange(joined)
      if (char && index < 5) {
        inputRefs.current[index + 1]?.focus()
      }
    },
    [digits, onChange],
  )

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
      }
    },
    [digits],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
      onChange(pasted)
      const focusIdx = Math.min(pasted.length, 5)
      inputRefs.current[focusIdx]?.focus()
    },
    [onChange],
  )

  return (
    <div className="flex justify-center gap-2" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el: HTMLInputElement | null) => { inputRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i]?.trim() ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(i, e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(i, e)}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className="auth-input h-12 w-10 rounded-lg border text-center text-xl font-semibold focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ caretColor: "transparent" }}
        />
      ))}
    </div>
  )
}

export default function LoginPage() {
  const searchParams = useSearchParams()
  const isNewUser = searchParams.get("registered") === "true"
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [policy, setPolicy] = useState<{ passkey_first?: boolean; enforce_passkey?: boolean; fallback_password?: boolean; fallback_magic_link?: boolean }>({})
  const [form, setForm] = useState({ email: "", password: "" })
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState<LoginStep>("credentials")
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [mfaLoading, setMfaLoading] = useState(false)
  const [showPasskeyInfo, setShowPasskeyInfo] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const supabase = createClientSupabaseClient()

  // Show toast if redirected here due to expired session
  useEffect(() => {
    if (searchParams.get("expired") === "true") {
      toast({
        variant: "destructive",
        title: "Session expired",
        description: "Please sign in again.",
      })
    }
    // Clear SW API cache on login page mount to prevent cross-account data
    // leaks from server-side signOut flows that bypass AppProvider cleanup.
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Derive combined "any submission in flight" flag for disabling the whole form
  const formBusy = loading || magicLinkLoading || passkeyLoading || forgotLoading

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      })
      const data = await res.json()

      if (data.emailUnverified) {
        try { sessionStorage.setItem("verifyEmail", form.email) } catch {}
        window.location.href = "/verify-email"
        return
      }

      if (!res.ok) {
        const msg = data.error || "Invalid credentials"
        setLoginError(msg)
        toast({ variant: "destructive", title: "Login failed", description: msg })
        return
      }

      if (data.requiresMfa && data.factorId) {
        setMfaFactorId(data.factorId)
        setStep("mfa-challenge")
        return
      }

      await supabase.from("users").update({ status: "online" }).eq("id", data.userId)
      // Hard navigation ensures session cookies set by the login API are fully
      // committed by the browser before the next page's server render fires.
      // router.push() (client-side nav) can race against Set-Cookie processing
      // on mobile — window.location.href matches what the passkey flow does.
      const redirectTo = searchParams.get("redirect")
      // Only allow relative paths to prevent open-redirect attacks
      const safeDest = redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/channels/me"
      window.location.href = safeDest
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Something went wrong"
      setLoginError(message)
      toast({ variant: "destructive", title: "Login failed", description: message })
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaFactorId || totpCode.length !== 6) return
    setMfaLoading(true)
    try {
      const res = await fetch("/api/auth/mfa-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factorId: mfaFactorId, code: totpCode }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast({ variant: "destructive", title: "Invalid code", description: data.error || "The code you entered is incorrect." })
        setTotpCode("")
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from("users").update({ status: "online" }).eq("id", user.id)
      }
      const rd = searchParams.get("redirect")
      window.location.href = rd && rd.startsWith("/") && !rd.startsWith("//") ? rd : "/channels/me"
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Verification failed"
      toast({ variant: "destructive", title: "Verification failed", description: message })
    } finally {
      setMfaLoading(false)
    }
  }

  async function handleRecoveryCodeRedeem(e: React.FormEvent) {
    e.preventDefault()
    if (!recoveryCode.trim()) return
    setMfaLoading(true)
    try {
      const res = await fetch("/api/auth/recovery-codes/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password, code: recoveryCode.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast({ variant: "destructive", title: "Recovery failed", description: data.error || "Invalid recovery code" })
        setRecoveryCode("")
        return
      }

      // Session cookies are now set by the redeem endpoint — navigate to the app
      const rd = searchParams.get("redirect")
      window.location.href = rd && rd.startsWith("/") && !rd.startsWith("//") ? rd : "/channels/me"
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Recovery failed"
      toast({ variant: "destructive", title: "Recovery failed", description: message })
    } finally {
      setMfaLoading(false)
    }
  }

  async function handleMagicLink() {
    if (!form.email) {
      toast({ variant: "destructive", title: "Enter your email first" })
      return
    }
    setMagicLinkLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: form.email,
        // Redirect to /auth/callback so the server-side route can exchange the
        // PKCE code for session cookies before forwarding to the app.  Pointing
        // directly at /channels/me means the code lands where no exchange
        // handler exists; the server sees no session and redirects to login.
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
      toast({ title: "Magic link sent!", description: `Check ${form.email} for your login link.` })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send magic link"
      toast({ variant: "destructive", title: "Failed to send magic link", description: message })
    } finally {
      setMagicLinkLoading(false)
    }
  }

  async function handleForgotPassword() {
    if (!form.email) {
      toast({ variant: "destructive", title: "Enter your email first" })
      return
    }
    setForgotLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
        redirectTo: `${window.location.origin}/update-password`,
      })
      if (error) throw error
      toast({ title: "Reset link sent!", description: `Check ${form.email} for a password reset link.` })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send reset link"
      toast({ variant: "destructive", title: "Failed to send reset link", description: message })
    } finally {
      setForgotLoading(false)
    }
  }

  async function handlePasskeyLogin() {
    if (!supportsPasskeys()) {
      toast({ variant: "destructive", title: "Passkeys unavailable", description: "Your browser/device does not support WebAuthn passkeys." })
      return
    }
    setPasskeyLoading(true)
    try {
      const resolvedPolicy = await startPasskeyLogin(form.email || undefined, "Trusted browser")
      if (resolvedPolicy) setPolicy(resolvedPolicy)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Passkey login failed"
      toast({ variant: "destructive", title: "Passkey login failed", description: message })
    } finally {
      setPasskeyLoading(false)
    }
  }

  const showFallbacks = !policy.enforce_passkey

  // ── MFA Challenge Screen ────────────────────────────────────────────────
  if (step === "mfa-challenge") {
    return (
      <div className="auth-surface rounded-2xl border p-8 shadow-2xl backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <VortexLogo size={48} />
          </div>
          <div className="mb-3 flex justify-center">
            <AccentBadge>
              <ShieldCheck className="h-3.5 w-3.5" /> Two-factor authentication
            </AccentBadge>
          </div>
          <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
            Enter your 2FA code
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
            Open your authenticator app and enter the 6-digit code.
          </p>
        </div>

        <form onSubmit={handleMfaVerify} className="space-y-4">
          <OtpInput value={totpCode} onChange={setTotpCode} disabled={mfaLoading} />
          <Button
            type="submit"
            disabled={totpCode.length !== 6 || mfaLoading}
            className="auth-btn-accent h-11 w-full border-0"
          >
            {mfaLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify
          </Button>
        </form>

        <div className="mt-6 border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <button
            type="button"
            onClick={() => setStep("recovery-code")}
            className="text-muted-interactive flex w-full items-center justify-center gap-2 text-sm"
          >
            <KeyRound className="h-4 w-4" /> Use a recovery code instead
          </button>
        </div>

        <button
          type="button"
          onClick={() => { setStep("credentials"); setTotpCode(""); setMfaFactorId(null) }}
          className="text-muted-interactive mt-3 w-full text-center text-sm"
        >
          Back to login
        </button>
      </div>
    )
  }

  // ── Recovery Code Screen ────────────────────────────────────────────────
  if (step === "recovery-code") {
    return (
      <div className="auth-surface rounded-2xl border p-8 shadow-2xl backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <VortexLogo size={48} />
          </div>
          <div className="mb-3 flex justify-center">
            <AccentBadge variant="warning">
              <KeyRound className="h-3.5 w-3.5" /> Account recovery
            </AccentBadge>
          </div>
          <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
            Use a recovery code
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
            Enter one of the recovery codes you saved during 2FA setup. Each code can only be used once.
          </p>
        </div>

        <form onSubmit={handleRecoveryCodeRedeem} className="space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="recovery-code"
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--theme-text-secondary)" }}
            >
              Recovery Code
            </Label>
            <Input
              id="recovery-code"
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              autoFocus
              disabled={mfaLoading}
              className="auth-input h-10 border text-center font-mono text-lg tracking-wider"
            />
          </div>
          <Button
            type="submit"
            disabled={!recoveryCode.trim() || mfaLoading}
            className="h-11 w-full font-medium"
            style={{ background: "var(--theme-warning)", color: "var(--theme-bg-tertiary)" }}
          >
            {mfaLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Redeem Recovery Code
          </Button>
        </form>

        <button
          type="button"
          onClick={() => { setStep("mfa-challenge"); setRecoveryCode("") }}
          className="text-muted-interactive mt-4 w-full text-center text-sm"
        >
          Back to 2FA code entry
        </button>

        <button
          type="button"
          onClick={() => { setStep("credentials"); setRecoveryCode(""); setTotpCode(""); setMfaFactorId(null) }}
          className="text-muted-interactive mt-2 w-full text-center text-sm"
        >
          Back to login
        </button>
      </div>
    )
  }

  // ── Credentials Screen (default) ────────────────────────────────────────
  return (
    <div className="auth-surface rounded-2xl border p-8 shadow-2xl backdrop-blur">
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <VortexLogo size={48} />
        </div>
        <div className="mb-3 flex justify-center">
          <AccentBadge>
            <Sparkles className="h-3.5 w-3.5" /> Secure sign in
          </AccentBadge>
        </div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          {isNewUser ? "Verify your email" : "Welcome back!"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
          {isNewUser ? "Check your inbox for a verification link, then log in below." : "Sign in to your account"}
        </p>
      </div>

      <div className="relative mb-4">
        <Button
          type="button"
          disabled={formBusy}
          onClick={handlePasskeyLogin}
          className="auth-btn-accent h-11 w-full border-0 font-medium transition-opacity hover:opacity-90"
        >
          {passkeyLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Continue with Passkey
        </Button>
        <button
          type="button"
          onClick={() => setShowPasskeyInfo(!showPasskeyInfo)}
          className="absolute right-0 -bottom-5 flex items-center gap-1 text-xs transition-colors"
          style={{ color: "var(--theme-text-secondary)" }}
          aria-label="About passkeys"
        >
          <Info className="h-3 w-3" /> What are passkeys?
        </button>
        {showPasskeyInfo && (
          <div
            className="mt-6 rounded-lg border p-3 text-xs"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: "var(--theme-bg-tertiary)",
              color: "var(--theme-text-secondary)",
            }}
          >
            Passkeys use your device biometrics (fingerprint, face) for phishing-resistant sign in. If your policy allows it, password and magic link remain available as backups.
          </div>
        )}
      </div>

      {showFallbacks && (
        <>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--theme-text-secondary)" }}
              >
                Email <span style={{ color: "var(--theme-danger)" }}>*</span>
              </Label>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); setLoginError(null) }}
                required
                autoFocus
                disabled={formBusy}
                aria-invalid={!!loginError}
                aria-describedby={loginError ? "login-error" : undefined}
                className="auth-input h-10 border"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="password"
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--theme-text-secondary)" }}
                >
                  Password <span style={{ color: "var(--theme-danger)" }}>*</span>
                </Label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={formBusy}
                  className="text-xs transition-colors hover:underline disabled:opacity-60"
                  style={{ color: "var(--theme-accent)" }}
                >
                  {forgotLoading ? "Sending\u2026" : "Forgot password?"}
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => { setForm({ ...form, password: e.target.value }); setLoginError(null) }}
                  required
                  disabled={formBusy}
                  aria-invalid={!!loginError}
                  aria-describedby={loginError ? "login-error" : undefined}
                  className="auth-input h-10 border pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "var(--theme-text-secondary)" }}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={0}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {loginError && (
              <p id="login-error" role="alert" className="text-xs font-medium" style={{ color: "var(--theme-danger)" }}>
                {loginError}
              </p>
            )}
            <Button
              type="submit"
              disabled={formBusy}
              className="auth-btn-accent h-11 w-full border-0 font-medium transition-opacity hover:opacity-90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Log In with Password
            </Button>
          </form>

          <Button
            type="button"
            variant="outline"
            disabled={formBusy}
            onClick={handleMagicLink}
            className="mt-4 h-10 w-full transition-colors"
            style={{
              borderColor: "rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--theme-text-secondary)",
            }}
          >
            {magicLinkLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send Magic Link
          </Button>
        </>
      )}

      {!showFallbacks && (
        <p className="mt-3 text-xs" style={{ color: "var(--theme-warning)" }}>
          Your account policy requires passkey login. Contact an owner/admin if you need recovery help.
        </p>
      )}

      <p className="mt-6 text-center text-sm" style={{ color: "var(--theme-text-secondary)" }}>
        Need an account?{" "}
        <Link href="/register" className="hover:underline" style={{ color: "var(--theme-accent)" }}>
          Register
        </Link>
      </p>
    </div>
  )
}
