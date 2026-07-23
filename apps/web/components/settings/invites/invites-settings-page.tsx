"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Copy, Check, QrCode, Trash2, UserPlus } from "lucide-react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"

interface Invite {
  id: string
  code: string
  max_uses: number
  use_count: number
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

function inviteUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}/register?invite=${code}`
}

function inviteState(invite: Invite): { label: string; color: string } {
  if (invite.revoked_at) return { label: "Revoked", color: "var(--theme-danger)" }
  if (invite.use_count >= invite.max_uses) return { label: "Used up", color: "var(--theme-text-muted)" }
  if (invite.expires_at && invite.expires_at <= new Date().toISOString()) return { label: "Expired", color: "var(--theme-text-muted)" }
  return { label: "Active", color: "var(--theme-success, #22c55e)" }
}

export function InvitesSettingsPage(): React.JSX.Element {
  const { toast } = useToast()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [maxUses, setMaxUses] = useState("1")
  const [expiresInDays, setExpiresInDays] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [qrInvite, setQrInvite] = useState<Invite | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const loadInvites = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await fetch("/api/invites")
      if (!res.ok) throw new Error("Failed to load invites")
      const data = await res.json()
      setInvites(data.invites ?? [])
    } catch {
      toast({ variant: "destructive", title: "Failed to load invites" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadInvites() }, [loadInvites])

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const parsedMaxUses = parseInt(maxUses, 10)
    if (!Number.isInteger(parsedMaxUses) || parsedMaxUses < 1 || parsedMaxUses > 50) {
      toast({ variant: "destructive", title: "Max uses must be between 1 and 50" })
      return
    }
    const body: { maxUses: number; expiresInDays?: number } = { maxUses: parsedMaxUses }
    if (expiresInDays.trim()) {
      const parsedDays = parseInt(expiresInDays, 10)
      if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 365) {
        toast({ variant: "destructive", title: "Expiry must be between 1 and 365 days" })
        return
      }
      body.expiresInDays = parsedDays
    }

    setCreating(true)
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create invite")
      toast({ title: "Invite created", description: `Code: ${data.invite.code}` })
      setInvites((prev) => [data.invite, ...prev])
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to create invite", description: err instanceof Error ? err.message : undefined })
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/invites/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to revoke invite")
      setInvites((prev) => prev.map((inv) => (inv.id === id ? { ...inv, revoked_at: new Date().toISOString() } : inv)))
    } catch {
      toast({ variant: "destructive", title: "Failed to revoke invite" })
    }
  }

  async function handleCopy(invite: Invite): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.code))
      setCopiedId(invite.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      toast({ variant: "destructive", title: "Failed to copy link" })
    }
  }

  async function handleShowQr(invite: Invite): Promise<void> {
    setQrInvite(invite)
    setQrDataUrl(await QRCode.toDataURL(inviteUrl(invite.code)))
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          Invites
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Vortex is invite-only — generate a short code or QR to bring someone onto the server. No phone number, ever.
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-4">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          Create an invite
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-max-uses" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
              Max uses
            </Label>
            <Input
              id="invite-max-uses"
              type="number"
              min={1}
              max={50}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="auth-input h-10 border w-28"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-expires" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
              Expires in (days, optional)
            </Label>
            <Input
              id="invite-expires"
              type="number"
              min={1}
              max={365}
              placeholder="Never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="auth-input h-10 border w-40"
            />
          </div>
          <Button type="submit" disabled={creating} className="h-10">
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create invite
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-white">Your invites</h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin" style={{ color: "var(--theme-text-muted)" }} />
          </div>
        ) : invites.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>You haven&apos;t created any invites yet.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((invite) => {
              const state = inviteState(invite)
              const canRevoke = state.label === "Active"
              return (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: "var(--theme-bg-tertiary)" }}
                >
                  <code className="text-sm font-mono font-semibold tracking-wider" style={{ color: "var(--theme-text-bright)" }}>
                    {invite.code}
                  </code>
                  <span className="text-xs font-medium" style={{ color: state.color }}>{state.label}</span>
                  <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                    {invite.use_count}/{invite.max_uses} used
                    {invite.expires_at ? ` • expires ${new Date(invite.expires_at).toLocaleDateString()}` : ""}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Copy invite link" onClick={() => handleCopy(invite)}>
                      {copiedId === invite.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Show QR code" onClick={() => handleShowQr(invite)}>
                      <QrCode className="w-4 h-4" />
                    </Button>
                    {canRevoke && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Revoke invite"
                        style={{ color: "var(--theme-danger)" }}
                        onClick={() => handleRevoke(invite.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={qrInvite !== null} onOpenChange={(open) => { if (!open) { setQrInvite(null); setQrDataUrl(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan to join</DialogTitle>
          </DialogHeader>
          {qrInvite && (
            <div className="flex flex-col items-center gap-3 py-2">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- locally-generated data: URL, not a remote image
                <img src={qrDataUrl} alt={`QR code for invite ${qrInvite.code}`} className="rounded-lg" width={256} height={256} />
              ) : (
                <Loader2 className="animate-spin" style={{ color: "var(--theme-text-muted)" }} />
              )}
              <code className="text-sm font-mono font-semibold tracking-wider" style={{ color: "var(--theme-text-bright)" }}>
                {qrInvite.code}
              </code>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
