"use client"

import { useState, useCallback, useEffect } from "react"
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import type { Factor } from "@supabase/supabase-js"

export function TwoFactorSection(): React.JSX.Element {
  const { toast } = useToast()
  const [supabase] = useState(() => createClientSupabaseClient())
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)
  const [recoveryCopied, setRecoveryCopied] = useState(false)

  // Unenroll dialog state — replaces window.prompt
  const [unenrollOpen, setUnenrollOpen] = useState(false)
  const [unenrollFactorId, setUnenrollFactorId] = useState<string | null>(null)
  const [unenrollPassword, setUnenrollPassword] = useState("")
  const [unenrolling, setUnenrolling] = useState(false)

  const loadFactors = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) {
        toast({ variant: "destructive", title: "Failed to load 2FA status" })
      }
      setFactors(data?.totp ?? [])
    } catch {
      toast({ variant: "destructive", title: "Failed to load 2FA status" })
    } finally {
      setLoading(false)
    }
  }, [supabase, toast])

  useEffect(() => { loadFactors() }, [loadFactors])

  async function handleEnroll(): Promise<void> {
    setEnrolling(true)
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "VortexChat" })
      if (error || !data) {
        toast({ variant: "destructive", title: "Failed to start 2FA setup", description: error?.message })
        return
      }
      setQrCode(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId(data.id)
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to start 2FA setup", description: err instanceof Error ? err.message : undefined })
    } finally {
      setEnrolling(false)
    }
  }

  async function handleVerify(): Promise<void> {
    if (!factorId || verifyCode.length !== 6) return
    setVerifying(true)
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) {
      toast({ variant: "destructive", title: "Challenge failed", description: challengeError.message })
      setVerifying(false)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code: verifyCode })
    if (verifyError) {
      toast({ variant: "destructive", title: "Invalid code", description: "The code you entered is incorrect." })
    } else {
      // Generate recovery codes automatically during MFA enrollment
      let generatedCodes = false
      try {
        const codesRes = await fetch("/api/auth/recovery-codes", { method: "POST" })
        const codesData = await codesRes.json()
        if (codesRes.ok && codesData.codes) {
          setRecoveryCodes(codesData.codes)
          setRecoveryAcknowledged(false)
          generatedCodes = true
          toast({ title: "2FA enabled!", description: "Save your recovery codes below before closing this dialog." })
        }
      } catch {
        // Recovery code generation is non-critical — toast a warning but don't block
      }
      if (!generatedCodes) {
        toast({ title: "2FA enabled!", description: "Your account is now protected with two-factor authentication. Generate recovery codes from the Recovery Codes section." })
      }
      setQrCode(null); setSecret(null); setFactorId(null); setVerifyCode("")
      loadFactors()
    }
    setVerifying(false)
  }

  function openUnenrollDialog(id: string): void {
    setUnenrollFactorId(id)
    setUnenrollPassword("")
    setUnenrollOpen(true)
  }

  async function submitUnenroll(): Promise<void> {
    if (!unenrollFactorId || !unenrollPassword) return
    setUnenrolling(true)
    try {
      const stepRes = await fetch("/api/auth/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: unenrollPassword }),
      })
      if (!stepRes.ok) {
        const data = await stepRes.json().catch(() => ({}))
        toast({ variant: "destructive", title: "Step-up failed", description: data.error ?? "Could not verify identity" })
        return
      }

      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: unenrollFactorId }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to disable 2FA", description: payload.error ?? "Unknown error" })
        return
      }

      toast({ title: "2FA disabled" })
      setUnenrollOpen(false)
      loadFactors()
    } catch {
      toast({ variant: "destructive", title: "Failed to disable 2FA" })
    } finally {
      setUnenrolling(false)
    }
  }

  async function copySecret(): Promise<void> {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const verified = factors.filter((f) => f.status === "verified")
  const has2FA = verified.length > 0

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

      {/* Current 2FA status */}
      <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: has2FA ? "rgba(35,165,90,0.1)" : "var(--theme-bg-secondary)", border: `1px solid ${has2FA ? "var(--theme-success)" : "var(--theme-bg-tertiary)"}` }}>
        {has2FA
          ? <ShieldCheck className="w-6 h-6 flex-shrink-0" style={{ color: "var(--theme-success)" }} />
          : <ShieldOff className="w-6 h-6 flex-shrink-0" style={{ color: "var(--theme-text-faint)" }} />}
        <div className="flex-1">
          <p className="text-sm font-medium text-white">{has2FA ? "2FA is enabled" : "2FA is not enabled"}</p>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            {has2FA ? `${verified.length} authenticator app${verified.length > 1 ? "s" : ""} registered.` : "Your account is protected by password only."}
          </p>
        </div>
        {has2FA
          ? (
            <button onClick={() => openUnenrollDialog(verified[0].id)} className="px-3 py-1.5 rounded text-sm transition-colors" style={{ background: "rgba(242,63,67,0.15)", color: "var(--theme-danger)", border: "1px solid rgba(242,63,67,0.3)" }}>
              Remove
            </button>
          )
          : !qrCode && (
            <button onClick={handleEnroll} disabled={enrolling} className="px-3 py-1.5 rounded text-sm font-semibold transition-colors" style={{ background: "var(--theme-accent)", color: "white" }}>
              {enrolling ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enable 2FA"}
            </button>
          )}
      </div>

      {/* QR code enrollment flow */}
      {qrCode && (
        <div className="rounded-lg p-4 space-y-4" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
          <p className="text-sm font-medium text-white">Scan with your authenticator app</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="2FA QR Code" className="w-40 h-40 rounded bg-white p-2 mx-auto" />
          {secret && (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs px-2 py-1.5 rounded break-all font-mono" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>{secret}</code>
              <button onClick={copySecret} className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded" style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-secondary)" }} title="Copy secret">
                {copied ? <Check className="w-4 h-4" style={{ color: "var(--theme-success)" }} /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          )}
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
              <button onClick={() => { setQrCode(null); setSecret(null); setFactorId(null) }} className="px-3 py-2 rounded text-sm" style={{ color: "var(--theme-text-muted)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Recovery codes generated during enrollment */}
      {recoveryCodes && (
        <div className="rounded-lg p-4 space-y-4" style={{ background: "var(--theme-bg-secondary)", border: "1px solid rgba(250,166,26,0.4)" }}>
          <div className="rounded-lg p-3" style={{ background: "rgba(250,166,26,0.1)", border: "1px solid rgba(250,166,26,0.3)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--theme-warning)" }}>Save your recovery codes</p>
            <p className="text-xs mt-1" style={{ color: "var(--theme-warning)" }}>
              2FA is now active. Save these backup codes — they will not be shown again. Use them if you lose access to your authenticator app.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((code, i) => (
              <div key={i} className="rounded px-3 py-2 text-center font-mono text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}>
                {code}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recoveryCodes.join("\n"))
                  setRecoveryCopied(true)
                  setTimeout(() => setRecoveryCopied(false), 2000)
                } catch { /* clipboard unavailable */ }
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-sm"
              style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-secondary)" }}
            >
              {recoveryCopied ? <Check className="w-4 h-4" style={{ color: "var(--theme-success)" }} /> : <Copy className="w-4 h-4" />}
              {recoveryCopied ? "Copied" : "Copy all"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
            <input type="checkbox" checked={recoveryAcknowledged} onChange={(e) => setRecoveryAcknowledged(e.target.checked)} />
            I have saved these recovery codes in a safe place
          </label>
          <button
            onClick={() => { setRecoveryCodes(null); setRecoveryAcknowledged(false) }}
            disabled={!recoveryAcknowledged}
            className="w-full py-2 rounded text-sm font-semibold transition-colors disabled:opacity-40"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            Done
          </button>
        </div>
      )}

      {/* Unenroll confirmation dialog — replaces window.prompt */}
      <Dialog open={unenrollOpen} onOpenChange={setUnenrollOpen}>
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
                value={unenrollPassword}
                onChange={(e) => setUnenrollPassword(e.target.value)}
                placeholder="Enter your password"
                onKeyDown={(e) => { if (e.key === "Enter") submitUnenroll() }}
                style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUnenrollOpen(false)}>Cancel</Button>
              <Button
                onClick={submitUnenroll}
                disabled={unenrolling || !unenrollPassword}
                style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
              >
                {unenrolling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Disable 2FA
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
