"use client"

import { useCallback, useRef, useState } from "react"
import { Loader2, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getStepUpStatus, submitStepUp, type StepUpMethods } from "@/lib/auth/step-up-client"

/**
 * Re-authentication prompt for the endpoints gated by
 * `lib/auth/better-auth.ts`'s step-up check (2FA disable, social linking).
 *
 * Usage — await the guard, then do the sensitive thing:
 *
 *   const { requireStepUp, stepUpDialog } = useStepUpPrompt()
 *   ...
 *   if (!(await requireStepUp())) return
 *   await authClient.linkSocial({ ... })
 *   ...
 *   return <>{stepUpDialog}</>
 *
 * `requireStepUp` resolves `true` only once a token is actually held, so the
 * caller never has to interpret the gate's 403 itself. Cancelling resolves
 * `false`, which callers should treat as "user backed out" — not an error.
 */
export function useStepUpPrompt(): {
  requireStepUp: () => Promise<boolean>
  stepUpDialog: React.JSX.Element
} {
  const [open, setOpen] = useState(false)
  const [methods, setMethods] = useState<StepUpMethods>({ password: false, totp: false })
  const [password, setPassword] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bridges the imperative `await requireStepUp()` call to the dialog's
  // event-driven lifecycle: held until the user verifies or backs out.
  const resolveRef = useRef<((verified: boolean) => void) | null>(null)

  const settle = useCallback((verified: boolean) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setOpen(false)
    setPassword("")
    setTotpCode("")
    setError(null)
    setSubmitting(false)
    resolve?.(verified)
  }, [])

  const requireStepUp = useCallback(async (): Promise<boolean> => {
    const status = await getStepUpStatus()
    if (!status) return false
    if (status.verified) return true

    // Nothing to challenge on (an OAuth-only account with no password and no
    // 2FA). The server still has to be the one to decide that, so ask it
    // rather than prompting for a factor the user cannot possibly supply.
    if (!status.methods.password && !status.methods.totp) {
      return (await submitStepUp()).ok
    }

    setMethods(status.methods)
    setPassword("")
    setTotpCode("")
    setError(null)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const canSubmit = (methods.password && password.length > 0) || (methods.totp && totpCode.length === 6)

  async function handleSubmit(): Promise<void> {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await submitStepUp({
      ...(methods.password && password ? { password } : {}),
      ...(methods.totp && totpCode.length === 6 ? { totpCode } : {}),
    })
    if (result.ok) {
      settle(true)
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  const stepUpDialog = (
    <Dialog open={open} onOpenChange={(next) => { if (!next) settle(false) }}>
      <DialogContent className="step-up-dialog">
        <DialogHeader>
          <DialogTitle className="text-white">Confirm it&apos;s you</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border p-3 step-up-notice">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 step-up-notice-icon" />
            <p className="text-sm">
              This action changes your account&apos;s security settings, so we need you to re-authenticate first.
            </p>
          </div>

          {methods.password && (
            <div className="space-y-2">
              <Label htmlFor="step-up-password" className="step-up-label">Password</Label>
              <Input
                id="step-up-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
                placeholder="Enter your password"
                className="step-up-field"
              />
            </div>
          )}

          {methods.totp && (
            <div className="space-y-2">
              <Label htmlFor="step-up-totp" className="step-up-label">
                {methods.password ? "Or a code from your authenticator app" : "Code from your authenticator app"}
              </Label>
              <Input
                id="step-up-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
                placeholder="000000"
                className="font-mono tracking-widest step-up-field"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm step-up-error">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => settle(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="step-up-submit"
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { requireStepUp, stepUpDialog }
}
