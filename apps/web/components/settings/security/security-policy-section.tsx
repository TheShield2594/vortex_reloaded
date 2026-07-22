"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useToast } from "@/components/ui/use-toast"

type SecurityPolicy = {
  passkey_first: boolean
  enforce_passkey: boolean
  fallback_password: boolean
  fallback_magic_link: boolean
}

const DEFAULT_POLICY: SecurityPolicy = {
  passkey_first: false,
  enforce_passkey: false,
  fallback_password: true,
  fallback_magic_link: true,
}

const DEBOUNCE_MS = 600

export function SecurityPolicySection(): React.JSX.Element {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_POLICY)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch("/api/auth/security/policy")
      .then((res) => res.json())
      .then((data) => { if (data.policy) setPolicy(data.policy) })
      .catch(() => {})
      .finally(() => setInitialLoaded(true))
  }, [])

  const flush = useCallback(async (next: SecurityPolicy) => {
    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const res = await fetch("/api/auth/security/policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
        signal: controller.signal,
      })
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to update security policy" })
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      toast({ variant: "destructive", title: "Failed to update security policy" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  function handleChange(next: SecurityPolicy): void {
    setPolicy(next)
    if (!initialLoaded) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => flush(next), DEBOUNCE_MS)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Account Security Policy</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Choose passkey-first login. Owners/admins can optionally enforce passkeys and disable fallback methods.</p>
      </div>
      <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <label className="flex items-center justify-between text-sm" style={{ color: "var(--theme-text-secondary)" }}><span>Passkey-first sign in</span><input type="checkbox" checked={policy.passkey_first} onChange={(e) => handleChange({ ...policy, passkey_first: e.target.checked })} /></label>
        <label className="flex items-center justify-between text-sm" style={{ color: "var(--theme-text-secondary)" }}><span>Enforce passkey (admins/owners optional)</span><input type="checkbox" checked={policy.enforce_passkey} onChange={(e) => handleChange({ ...policy, enforce_passkey: e.target.checked })} /></label>
        <label className="flex items-center justify-between text-sm" style={{ color: "var(--theme-text-secondary)" }}><span>Allow password fallback</span><input type="checkbox" checked={policy.fallback_password} onChange={(e) => handleChange({ ...policy, fallback_password: e.target.checked })} disabled={policy.enforce_passkey} /></label>
        <label className="flex items-center justify-between text-sm" style={{ color: "var(--theme-text-secondary)" }}><span>Allow magic-link fallback</span><input type="checkbox" checked={policy.fallback_magic_link} onChange={(e) => handleChange({ ...policy, fallback_magic_link: e.target.checked })} disabled={policy.enforce_passkey} /></label>
      </div>
      {loading && <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Saving policy…</p>}
    </div>
  )
}
