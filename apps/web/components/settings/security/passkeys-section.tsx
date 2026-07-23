"use client"

import { useState, useCallback, useEffect } from "react"
import { Loader2, KeyRound, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { authClient } from "@/lib/auth/auth-client"

interface PasskeyRow {
  id: string
  name?: string
  createdAt: string
}

export function PasskeysSection(): React.JSX.Element {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [credentials, setCredentials] = useState<PasskeyRow[]>([])

  // Rename dialog state
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const [renaming, setRenaming] = useState(false)

  const loadCredentials = useCallback(async (): Promise<void> => {
    try {
      const { data } = await authClient.passkey.listUserPasskeys()
      if (Array.isArray(data)) setCredentials(data as unknown as PasskeyRow[])
    } catch {
      // Network error — leave credentials unchanged
    }
  }, [])

  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  async function handleRegisterPasskey(): Promise<void> {
    setLoading(true)
    try {
      const { error } = await authClient.passkey.addPasskey({ name: "Primary passkey" })
      if (error) throw new Error(error.message)
      toast({ title: "Passkey added", description: "Your account can now use passkey-first login." })
      await loadCredentials()
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Could not register passkey", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  function openRenameDialog(id: string, currentName: string): void {
    setRenameId(id)
    setRenameName(currentName)
    setRenameOpen(true)
  }

  async function submitRename(): Promise<void> {
    if (!renameId || !renameName.trim()) return
    setRenaming(true)
    try {
      const { error } = await authClient.passkey.updatePasskey({ id: renameId, name: renameName.trim() })
      if (error) throw new Error(error.message)
      await loadCredentials()
      setRenameOpen(false)
    } catch {
      toast({ variant: "destructive", title: "Failed to rename passkey" })
    } finally {
      setRenaming(false)
    }
  }

  async function revoke(id: string): Promise<void> {
    try {
      const { error } = await authClient.passkey.deletePasskey({ id })
      if (error) throw new Error(error.message)
      loadCredentials()
    } catch {
      toast({ variant: "destructive", title: "Failed to revoke passkey" })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Passkeys</h3>
        <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Passkeys are phishing-resistant and work across biometrics, device PIN, or hardware keys. Keep at least one backup passkey on a second device.</p>
      </div>
      <Button onClick={handleRegisterPasskey} disabled={loading} style={{ background: "var(--theme-positive)" }}>
        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />} Register Passkey
      </Button>
      <div className="space-y-2">
        {credentials.map((cred) => (
          <div key={cred.id} className="rounded p-3 flex items-center gap-2" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
            <div className="flex-1">
              <p className="text-sm text-white">{cred.name || "Unnamed device"}</p>
              <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Added: {cred.createdAt ? new Date(cred.createdAt).toLocaleString() : "Unknown"}</p>
            </div>
            <button onClick={() => openRenameDialog(cred.id, cred.name || "")} className="p-2 rounded" style={{ background: "var(--theme-surface-input)" }} aria-label="Rename passkey"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => revoke(cred.id)} className="p-2 rounded" style={{ background: "rgba(242,63,67,0.15)", color: "var(--theme-danger)" }} aria-label="Revoke passkey"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {credentials.length === 0 && <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>No passkeys yet. Add one now and keep password/magic-link recovery enabled until you register a backup device.</p>}
      </div>

      {/* Rename dialog — replaces window.prompt */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">Rename Passkey</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label style={{ color: "var(--theme-text-secondary)" }}>Device Name</Label>
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="e.g. MacBook Pro"
                onKeyDown={(e) => { if (e.key === "Enter") submitRename() }}
                style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button onClick={submitRename} disabled={renaming || !renameName.trim()} style={{ background: "var(--theme-accent)", color: "white" }}>
                {renaming ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
