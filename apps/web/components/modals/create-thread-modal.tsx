"use client"

import { useState } from "react"
import { Loader2, MessageSquare } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import type { ThreadRow } from "@/types/database"
import { AUTO_ARCHIVE_OPTIONS, DEFAULT_AUTO_ARCHIVE_DURATION, type AutoArchiveDuration } from "@vortex/shared"

interface Props {
  open: boolean
  onClose: () => void
  /** Create thread from a specific message (message action) */
  messageId?: string | null
  /** Create standalone thread in a channel (from + menu) */
  channelId?: string | null
  /** Called with the newly created thread so the parent can open the thread panel */
  onCreated: (thread: ThreadRow) => void
}

export function CreateThreadModal({ open, onClose, messageId, channelId, onCreated }: Props) {
  const [name, setName] = useState("")
  const [autoArchiveDuration, setAutoArchiveDuration] = useState(DEFAULT_AUTO_ARCHIVE_DURATION)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  async function handleCreate() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const body = messageId
        ? { messageId, name: name.trim(), autoArchiveDuration }
        : { channelId, name: name.trim(), autoArchiveDuration }
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create thread")
      toast({ title: "Thread created!" })
      setName("")
      onCreated(data as ThreadRow)
      onClose()
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ background: "var(--theme-bg-primary)", border: "1px solid var(--theme-bg-tertiary)", color: "white" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <MessageSquare className="w-5 h-5" style={{ color: "var(--theme-accent)" }} />
            Create Thread
          </DialogTitle>
          <DialogDescription className="sr-only">Start a new thread from this message</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label style={{ color: "var(--theme-text-secondary)" }}>Thread Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) handleCreate()
              }}
              placeholder="e.g. Discussion about this"
              autoFocus
              style={{ background: "var(--theme-bg-tertiary)", border: "1px solid var(--theme-text-faint)", color: "white" }}
            />
          </div>

          <div className="space-y-2">
            <Label style={{ color: "var(--theme-text-secondary)" }}>Auto-Archive After</Label>
            <select
              value={autoArchiveDuration}
              onChange={(e) => setAutoArchiveDuration(Number(e.target.value) as AutoArchiveDuration)}
              className="w-full rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--theme-bg-tertiary)", border: "1px solid var(--theme-text-faint)", color: "white" }}
              aria-label="Auto-archive duration"
            >
              {AUTO_ARCHIVE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
              Thread will auto-archive after this period of inactivity.
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={onClose}
              style={{ color: "var(--theme-text-secondary)" }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              style={{ background: "var(--theme-accent)", color: "white" }}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Thread
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
