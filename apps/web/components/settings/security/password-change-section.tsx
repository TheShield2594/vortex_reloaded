"use client"

import { useState } from "react"
import { Loader2, Eye, EyeOff, Lock } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

export function PasswordChangeSection(): React.JSX.Element {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" })
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (form.newPassword !== form.confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match" })
      return
    }
    if (form.newPassword.length < 12) {
      toast({ variant: "destructive", title: "Password must be at least 12 characters" })
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
          revokeOtherSessions,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: "destructive", title: "Password change failed", description: data.error || "Please try again" })
        return
      }
      if (data.warning) {
        toast({ title: "Password changed", description: data.warning, variant: "destructive" })
      } else {
        toast({ title: "Password changed", description: revokeOtherSessions ? "All other sessions have been revoked." : "Your password has been updated." })
      }
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Error", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Change Password</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Update your account password. Minimum 12 characters required.</p>
      </div>
      <form onSubmit={handleSubmit} className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
        <div className="space-y-1">
          <label htmlFor="current-password" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>Current Password</label>
          <div className="relative">
            <input
              id="current-password"
              type={showCurrent ? "text" : "password"}
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required
              className="w-full rounded px-3 py-2 pr-10 text-sm focus:outline-none"
              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}
            />
            <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: "var(--theme-text-muted)" }}>
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="new-password" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>New Password</label>
          <div className="relative">
            <input
              id="new-password"
              type={showNew ? "text" : "password"}
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              required
              minLength={12}
              className="w-full rounded px-3 py-2 pr-10 text-sm focus:outline-none"
              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}
            />
            <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: "var(--theme-text-muted)" }}>
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {form.newPassword.length > 0 && form.newPassword.length < 12 && (
            <p className="text-xs" style={{ color: "var(--theme-danger)" }}>Must be at least 12 characters ({form.newPassword.length}/12)</p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="confirm-password" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>Confirm New Password</label>
          <input
            id="confirm-password"
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            required
            className="w-full rounded px-3 py-2 text-sm focus:outline-none"
            style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}
          />
          {form.confirmPassword.length > 0 && form.newPassword !== form.confirmPassword && (
            <p className="text-xs" style={{ color: "var(--theme-danger)" }}>Passwords do not match</p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
          <input type="checkbox" checked={revokeOtherSessions} onChange={(e) => setRevokeOtherSessions(e.target.checked)} />
          Sign out all other sessions after changing password
        </label>
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={loading || !form.currentPassword || !form.newPassword || !form.confirmPassword}
            className="px-4 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Lock className="w-4 h-4 inline mr-1" />Change Password</>}
          </button>
        </div>
      </form>
    </div>
  )
}
