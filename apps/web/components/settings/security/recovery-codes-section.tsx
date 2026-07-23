"use client"

import { useState } from "react"
import { Loader2, KeyRound, Copy, Check, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { authClient } from "@/lib/auth/auth-client"

/**
 * Better Auth's `twoFactor` plugin stores backup codes as a single opaque,
 * internally-encoded blob (see schema/better-auth.ts's `two_factors` table)
 * rather than one row per code — there's no "N of M remaining" status
 * endpoint the way the old hand-rolled `recovery_codes` table could offer.
 * This section is regenerate-only: it always produces a fresh set of 10 and
 * invalidates whatever set existed before.
 */
export function RecoveryCodesSection(): React.JSX.Element {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [generating, setGenerating] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleGenerate(): Promise<void> {
    if (!password) return
    setGenerating(true)
    try {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password })
      if (error || !data) {
        toast({ variant: "destructive", title: "Failed to generate recovery codes", description: error?.message })
        return
      }
      setCodes(data.backupCodes)
      setAcknowledged(false)
      toast({ title: "Recovery codes generated", description: "Save these codes in a safe place. They will not be shown again." })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Error", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopyCodes(): Promise<void> {
    if (!codes) return
    try {
      await navigator.clipboard.writeText(codes.join("\n"))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  function handleClose(): void {
    setOpen(false)
    setPassword("")
    setCodes(null)
    setAcknowledged(false)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Recovery Codes</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
          Recovery codes let you access your account if you lose your authenticator app. Regenerating replaces any
          existing set — each code can only be used once. Requires two-factor authentication to be enabled.
        </p>
      </div>

      <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <KeyRound className="w-6 h-6 flex-shrink-0" style={{ color: "var(--theme-text-faint)" }} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Generate a new set of recovery codes</p>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Requires your password to confirm.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-semibold transition-colors"
          style={{ background: "var(--theme-accent)", color: "white" }}
        >
          <RefreshCw className="w-4 h-4" /> Generate
        </button>
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); else setOpen(true) }}>
        <DialogContent style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">Generate Recovery Codes</DialogTitle>
          </DialogHeader>

          {!codes && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label style={{ color: "var(--theme-text-secondary)" }}>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleGenerate() }}
                  style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleGenerate} disabled={generating || !password} style={{ background: "var(--theme-accent)", color: "white" }}>
                  {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Generate
                </Button>
              </div>
            </div>
          )}

          {codes && (
            <div className="space-y-4">
              <div className="rounded-lg p-3" style={{ background: "rgba(250,166,26,0.1)", border: "1px solid rgba(250,166,26,0.3)" }}>
                <p className="text-sm font-medium" style={{ color: "var(--theme-warning)" }}>Save these codes now</p>
                <p className="text-xs mt-1" style={{ color: "var(--theme-warning)" }}>
                  These codes will not be shown again. Store them somewhere safe and accessible.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {codes.map((code, i) => (
                  <div key={i} className="rounded px-3 py-2 text-center font-mono text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}>
                    {code}
                  </div>
                ))}
              </div>
              <button type="button" onClick={handleCopyCodes} className="flex items-center gap-1 px-3 py-1.5 rounded text-sm" style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-secondary)" }}>
                {copied ? <Check className="w-4 h-4" style={{ color: "var(--theme-success)" }} /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy all"}
              </button>
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                I have saved these recovery codes in a safe place
              </label>
              <button
                onClick={handleClose}
                disabled={!acknowledged}
                className="w-full py-2 rounded text-sm font-semibold transition-colors disabled:opacity-40"
                style={{ background: "var(--theme-accent)", color: "white" }}
              >
                Done
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
