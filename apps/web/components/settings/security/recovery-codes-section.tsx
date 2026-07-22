"use client"

import { useState, useCallback, useEffect } from "react"
import { Loader2, KeyRound, Copy, Check, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

export function RecoveryCodesSection(): React.JSX.Element {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [total, setTotal] = useState(0)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/auth/recovery-codes")
      const data = await res.json()
      if (res.ok) {
        setRemaining(data.remaining ?? 0)
        setTotal(data.total ?? 0)
      }
    } catch {
      // Silently handle — recovery codes may not be set up yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function handleGenerate(): Promise<void> {
    setGenerating(true)
    try {
      const res = await fetch("/api/auth/recovery-codes", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to generate recovery codes", description: data.error })
        return
      }
      setCodes(data.codes)
      setTotal(data.codes.length)
      setRemaining(data.codes.length)
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

  function handleDismissCodes(): void {
    setCodes(null)
    setAcknowledged(false)
    loadStatus()
  }

  if (loading) {
    return <div className="flex justify-center py-4"><Loader2 className="animate-spin" style={{ color: "var(--theme-text-muted)" }} /></div>
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Recovery Codes</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
          Recovery codes let you access your account if you lose your authenticator app or passkey. Each code can only be used once.
        </p>
      </div>

      {/* Show generated codes */}
      {codes && (
        <div className="rounded-lg p-4 space-y-4" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
          <div className="rounded-lg p-3" style={{ background: "rgba(250,166,26,0.1)", border: "1px solid rgba(250,166,26,0.3)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--theme-warning)" }}>Save these codes now</p>
            <p className="text-xs mt-1" style={{ color: "var(--theme-warning)" }}>
              These codes will not be shown again. Store them somewhere safe and accessible — like a password manager or printed copy.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {codes.map((code, i) => (
              <div key={i} className="rounded px-3 py-2 text-center font-mono text-sm" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}>
                {code}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCopyCodes} className="flex items-center gap-1 px-3 py-1.5 rounded text-sm" style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-secondary)" }}>
              {copied ? <Check className="w-4 h-4" style={{ color: "var(--theme-success)" }} /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy all"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            I have saved these recovery codes in a safe place
          </label>
          <button
            onClick={handleDismissCodes}
            disabled={!acknowledged}
            className="w-full py-2 rounded text-sm font-semibold transition-colors disabled:opacity-40"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            Done
          </button>
        </div>
      )}

      {/* Status and generate/regenerate button */}
      {!codes && (
        <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: total > 0 ? "rgba(35,165,90,0.1)" : "var(--theme-bg-secondary)", border: `1px solid ${total > 0 ? "var(--theme-success)" : "var(--theme-bg-tertiary)"}` }}>
          <KeyRound className="w-6 h-6 flex-shrink-0" style={{ color: total > 0 ? "var(--theme-success)" : "var(--theme-text-faint)" }} />
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              {total > 0 ? `${remaining} of ${total} codes remaining` : "No recovery codes generated"}
            </p>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
              {total > 0 ? "Generate new codes to replace the current set." : "Generate codes to protect against losing access to your authenticator."}
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-semibold transition-colors"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {total > 0 ? "Regenerate" : "Generate"}
          </button>
        </div>
      )}

      {total > 0 && remaining <= 2 && remaining > 0 && !codes && (
        <div className="rounded p-3" style={{ background: "rgba(250,166,26,0.08)", border: "1px solid rgba(250,166,26,0.3)" }}>
          <p className="text-xs" style={{ color: "var(--theme-warning)" }}>
            You are running low on recovery codes. Consider regenerating a new set.
          </p>
        </div>
      )}
    </div>
  )
}
