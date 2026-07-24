"use client"

import { useState, useCallback, useEffect } from "react"
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { authClient } from "@/lib/auth/auth-client"
import { submitStepUp } from "@/lib/auth/step-up-client"

export function TwoFactorSection(): React.JSX.Element {
  const { toast } = useToast()
  const [has2FA, setHas2FA] = useState(false)
  const [loading, setLoading] = useState(true)

  // Enable flow — password gate, then QR + backup codes in one response
  const [enableOpen, setEnableOpen] = useState(false)
  const [enablePassword, setEnablePassword] = useState("")
  const [enrolling, setEnrolling] = useState(false)
  const [totpURI, setTotpURI] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [verifyCode, setVerifyCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [codesAcknowledged, setCodesAcknowledged] = useState(false)
  const [copied, setCopied] = useState(false)

  // Disable dialog state
  const [disableOpen, setDisableOpen] = useState(false)
  const [disablePassword, setDisablePassword] = useState("")
  const [disabling, setDisabling] = useState(false)

  const loadStatus = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const { data } = await authClient.getSession()
      setHas2FA(Boolean((data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled))
    } catch {
      toast({ variant: "destructive", title: "Failed to load 2FA status" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function handleStartEnroll(): Promise<void> {
    if (!enablePassword) return
    setEnrolling(true)
    try {
      const { data, error } = await authClient.twoFactor.enable({ password: enablePassword, issuer: "Vortex" })
      if (error || !data) {
        toast({ variant: "destructive", title: "Failed to start 2FA setup", description: error?.message })
        return
      }
      setTotpURI(data.totpURI)
      // Rendered entirely client-side — the URI embeds the raw TOTP secret,
      // so it must never leave the browser (e.g. to a third-party QR API).
      setQrDataUrl(await QRCode.toDataURL(data.totpURI))
      setBackupCodes(data.backupCodes)
      setCodesAcknowledged(false)
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to start 2FA setup", description: err instanceof Error ? err.message : undefined })
    } finally {
      setEnrolling(false)
    }
  }

  async function handleVerify(): Promise<void> {
    if (verifyCode.length !== 6) return
    setVerifying(true)
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: verifyCode })
      if (error) {
        toast({ variant: "destructive", title: "Invalid code", description: "The code you entered is incorrect." })
        return
      }
      toast({ title: "2FA enabled!", description: "Save your recovery codes below before closing this dialog." })
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Verification failed", description: err instanceof Error ? err.message : undefined })
    } finally {
      setVerifying(false)
    }
  }

  function closeEnrollDialog(): void {
    setEnableOpen(false)
    setEnablePassword("")
    setTotpURI(null)
    setQrDataUrl(null)
    setBackupCodes(null)
    setVerifyCode("")
    loadStatus()
  }

  async function submitDisable(): Promise<void> {
    if (!disablePassword) return
    setDisabling(true)
    try {
      // `/two-factor/disable` is step-up gated (lib/auth/better-auth.ts), so it
      // needs a fresh re-auth token before Better Auth will even look at the
      // request. Better Auth requires the password here regardless, so spend
      // the one already typed rather than prompting for it a second time.
      const stepUp = await submitStepUp({ password: disablePassword })
      if (!stepUp.ok) {
        toast({ variant: "destructive", title: "Failed to disable 2FA", description: stepUp.error })
        return
      }

      const { error } = await authClient.twoFactor.disable({ password: disablePassword })
      if (error) {
        toast({ variant: "destructive", title: "Failed to disable 2FA", description: error.message })
        return
      }
      toast({ title: "2FA disabled" })
      setDisableOpen(false)
      setDisablePassword("")
      loadStatus()
    } catch {
      toast({ variant: "destructive", title: "Failed to disable 2FA" })
    } finally {
      setDisabling(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin" style={{ color: "var(--theme-text-muted)" }} /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Two-Factor Authentication</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
          Add an extra layer of security to your account using an authenticator app (Google Authenticator, Authy, etc.).
        </p>
      </div>

      <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: has2FA ? "rgba(35,165,90,0.1)" : "var(--theme-bg-secondary)", border: `1px solid ${has2FA ? "var(--theme-success)" : "var(--theme-bg-tertiary)"}` }}>
        {has2FA
          ? <ShieldCheck className="w-6 h-6 flex-shrink-0" style={{ color: "var(--theme-success)" }} />
          : <ShieldOff className="w-6 h-6 flex-shrink-0" style={{ color: "var(--theme-text-faint)" }} />}
        <div className="flex-1">
          <p className="text-sm font-medium text-white">{has2FA ? "2FA is enabled" : "2FA is not enabled"}</p>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            {has2FA ? "Your account is protected by an authenticator app." : "Your account is protected by password only."}
          </p>
        </div>
        {has2FA
          ? (
            <button onClick={() => setDisableOpen(true)} className="px-3 py-1.5 rounded text-sm transition-colors" style={{ background: "rgba(242,63,67,0.15)", color: "var(--theme-danger)", border: "1px solid rgba(242,63,67,0.3)" }}>
              Remove
            </button>
          )
          : (
            <button onClick={() => setEnableOpen(true)} className="px-3 py-1.5 rounded text-sm font-semibold transition-colors" style={{ background: "var(--theme-accent)", color: "white" }}>
              Enable 2FA
            </button>
          )}
      </div>

      {/* Enrollment dialog */}
      <Dialog open={enableOpen} onOpenChange={(open) => { if (!open) closeEnrollDialog(); else setEnableOpen(true) }}>
        <DialogContent style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">Enable Two-Factor Authentication</DialogTitle>
          </DialogHeader>

          {!totpURI && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>Enter your password to begin 2FA setup.</p>
              <div className="space-y-2">
                <Label style={{ color: "var(--theme-text-secondary)" }}>Password</Label>
                <Input
                  type="password"
                  value={enablePassword}
                  onChange={(e) => setEnablePassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleStartEnroll() }}
                  style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeEnrollDialog}>Cancel</Button>
                <Button onClick={handleStartEnroll} disabled={enrolling || !enablePassword} style={{ background: "var(--theme-accent)", color: "white" }}>
                  {enrolling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Continue
                </Button>
              </div>
            </div>
          )}

          {totpURI && qrDataUrl && backupCodes && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-white">Scan with your authenticator app</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="2FA QR Code"
                className="w-40 h-40 rounded bg-white p-2 mx-auto"
              />
              <code className="block text-xs px-2 py-1.5 rounded break-all font-mono" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>{totpURI}</code>

              <div className="space-y-2">
                <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>Enter the 6-digit code from your app to confirm:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-32 px-3 py-2 rounded text-center text-lg tracking-widest focus:outline-none font-mono"
                    style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}
                  />
                  <button onClick={handleVerify} disabled={verifyCode.length !== 6 || verifying} className="px-4 py-2 rounded font-semibold transition-colors disabled:opacity-50" style={{ background: "var(--theme-accent)", color: "white" }}>
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                  </button>
                </div>
              </div>

              <div className="rounded-lg p-3" style={{ background: "rgba(250,166,26,0.1)", border: "1px solid rgba(250,166,26,0.3)" }}>
                <p className="text-sm font-medium" style={{ color: "var(--theme-warning)" }}>Save your recovery codes</p>
                <p className="text-xs mt-1" style={{ color: "var(--theme-warning)" }}>
                  These backup codes will not be shown again. Use them if you lose access to your authenticator app.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <div key={i} className="rounded px-3 py-2 text-center font-mono text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}>
                    {code}
                  </div>
                ))}
              </div>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(backupCodes.join("\n"))
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  } catch { /* clipboard unavailable */ }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-sm"
                style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-secondary)" }}
              >
                {copied ? <Check className="w-4 h-4" style={{ color: "var(--theme-success)" }} /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy all"}
              </button>
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                <input type="checkbox" checked={codesAcknowledged} onChange={(e) => setCodesAcknowledged(e.target.checked)} />
                I have saved these recovery codes in a safe place
              </label>
              <button
                onClick={closeEnrollDialog}
                disabled={!codesAcknowledged}
                className="w-full py-2 rounded text-sm font-semibold transition-colors disabled:opacity-40"
                style={{ background: "var(--theme-accent)", color: "white" }}
              >
                Done
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable confirmation dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">Disable Two-Factor Authentication</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>
              Enter your password to confirm disabling 2FA. This will remove the extra layer of protection from your account.
            </p>
            <div className="space-y-2">
              <Label style={{ color: "var(--theme-text-secondary)" }}>Current Password</Label>
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Enter your password"
                onKeyDown={(e) => { if (e.key === "Enter") submitDisable() }}
                style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDisableOpen(false)}>Cancel</Button>
              <Button
                onClick={submitDisable}
                disabled={disabling || !disablePassword}
                style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
              >
                {disabling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Disable 2FA
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
