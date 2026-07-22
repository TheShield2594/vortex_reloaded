"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2, Copy, Check, Webhook } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { copyToClipboard, createWebhook, deleteWebhook, formatChannelName } from "@/lib/webhooks"

interface Channel {
  id: string
  name: string
}

interface WebhookEntry {
  id: string
  name: string
  channel_id: string
  url: string
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  serverId: string
  channels: Channel[]
}

export function WebhooksModal({ open, onClose, serverId, channels }: Props) {
  const { toast } = useToast()
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("Webhook")
  const [newChannelId, setNewChannelId] = useState(channels[0]?.id ?? "")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/servers/${serverId}/webhooks`)
      .then((r) => r.json())
      .then((d) => { setWebhooks(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open, serverId])

  async function handleCreate() {
    if (!newChannelId) return
    setCreating(true)
    try {
      const res = await createWebhook(serverId, newChannelId, newName)
      if (res.ok) {
        const wh = await res.json()
        setWebhooks((prev) => [...prev, wh])
        setNewName("Webhook")
        toast({ title: "Webhook created" })
      } else {
        const data = await res.json().catch(() => ({ error: "Failed to create webhook" }))
        toast({ variant: "destructive", title: "Failed to create webhook", description: data.error })
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to create webhook", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await deleteWebhook(serverId, id)
      if (res.ok) {
        setWebhooks((prev) => prev.filter((w) => w.id !== id))
        toast({ title: "Webhook deleted" })
      } else {
        const data = await res.json().catch(() => ({ error: "Failed to delete webhook" }))
        toast({ variant: "destructive", title: "Failed to delete webhook", description: data.error })
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to delete webhook", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setDeletingId(null)
    }
  }

  async function copyUrl(id: string, url: string) {
    try {
      await copyToClipboard(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Clipboard write failed; avoid showing copied state
    }
  }

  function channelName(channelId: string) {
    return formatChannelName(channelId, channels)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Webhook className="w-5 h-5" style={{ color: "var(--theme-accent)" }} />
            Webhooks
          </DialogTitle>
          <DialogDescription className="sr-only">Manage server webhooks</DialogDescription>
          <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
            Create URLs that allow external services to post messages to your server.
          </p>
        </DialogHeader>

        {/* Create form */}
        <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>New Webhook</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Webhook name"
              className="flex-1 px-3 py-2 rounded text-sm focus:outline-none"
              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}
            />
            <select
              value={newChannelId}
              onChange={(e) => setNewChannelId(e.target.value)}
              className="px-2 py-2 rounded text-sm focus:outline-none"
              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-surface-elevated)" }}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
            <button
              onClick={handleCreate}
              disabled={creating || !newChannelId}
              className="px-3 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ background: "var(--theme-accent)", color: "white" }}
              aria-label="Create webhook"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin" style={{ color: "var(--theme-text-muted)" }} />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: "var(--theme-text-muted)" }}>
            No webhooks yet. Create one above.
          </div>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh) => (
              <div key={wh.id} className="rounded-lg p-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-medium text-white">{wh.name}</p>
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>#{channelName(wh.channel_id)}</p>
                  </div>
                  <button onClick={() => handleDelete(wh.id)} disabled={deletingId === wh.id} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors disabled:opacity-50" style={{ color: "var(--theme-text-faint)" }} title="Delete" aria-label={`Delete webhook ${wh.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs px-2 py-1 rounded truncate font-mono" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>
                    {wh.url}
                  </code>
                  <button
                    onClick={() => copyUrl(wh.id, wh.url)}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-white/10"
                    style={{ color: copiedId === wh.id ? "var(--theme-success)" : "var(--theme-text-muted)" }}
                    title="Copy URL"
                    aria-label="Copy webhook URL"
                  >
                    {copiedId === wh.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
