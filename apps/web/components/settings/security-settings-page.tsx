"use client"

import { useState } from "react"
import { Shield, Download, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { PasskeysSection } from "@/components/settings/security/passkeys-section"
import { SecurityPolicySection } from "@/components/settings/security/security-policy-section"
import { PasswordChangeSection } from "@/components/settings/security/password-change-section"
import { RecoveryCodesSection } from "@/components/settings/security/recovery-codes-section"
import { SessionManagementSection } from "@/components/settings/security/session-management-section"
import { TwoFactorSection } from "@/components/settings/security/two-factor-section"

interface Props {
  userId: string
  hasTOTP: boolean
  userEmail: string
}

export function SecuritySettingsPage({ userId: _userId, hasTOTP: _hasTOTP, userEmail }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [supabase] = useState(() => createClientSupabaseClient())

  // Data export
  const [exporting, setExporting] = useState(false)

  async function handleForcedLogout(): Promise<void> {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        toast({ variant: "destructive", title: "Sign out failed", description: error.message })
        return
      }
      router.replace("/login")
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Sign out failed", description: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          Security &amp; Privacy
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Manage your password, two-factor authentication, passkeys, and active sessions.
        </p>
      </div>

      {/* Passkeys */}
      <PasskeysSection />

      {/* Two-Factor Authentication */}
      <TwoFactorSection />

      {/* Security Policy */}
      <SecurityPolicySection />

      {/* Change Password */}
      <PasswordChangeSection />

      {/* Recovery Codes */}
      <RecoveryCodesSection />

      {/* Session Management */}
      <SessionManagementSection onForcedLogout={handleForcedLogout} />

      {/* Account email */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Account Email
        </h2>
        <div
          className="rounded-lg p-4 flex items-center gap-3"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <Shield className="w-5 h-5 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>{userEmail}</p>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
              Email changes require verification. Contact support to update.
            </p>
          </div>
        </div>
      </section>

      {/* Data Export */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Your Data
        </h2>
        <div
          className="rounded-lg p-4 flex items-start gap-4"
          style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
        >
          <Download className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "var(--theme-text-muted)" }} />
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>
              Export your data
            </p>
            <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
              Download a JSON file containing your profile, messages, DMs, friends, and server memberships.
            </p>
          </div>
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true)
              try {
                const res = await fetch("/api/users/export")
                if (!res.ok) throw new Error("Export failed")
                const blob = await res.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "vortexchat-export.json"
                document.body.appendChild(a)
                a.click()
                a.remove()
                URL.revokeObjectURL(url)
                toast({ title: "Export downloaded" })
              } catch {
                toast({ variant: "destructive", title: "Failed to export data" })
              } finally {
                setExporting(false)
              }
            }}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {exporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {exporting ? "Exporting…" : "Download"}
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Your export includes up to 10,000 recent messages and 5,000 reactions. Exports are generated in real time.
        </p>
      </section>
    </div>
  )
}
