"use client"

import { useEffect, useState } from "react"
import { Gift, Save, Trophy, Clock, Users, XCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface Channel {
  id: string
  name: string
  type: string
}

interface Giveaway {
  id: string
  title: string
  prize: string
  description: string | null
  winners_count: number
  ends_at: string
  status: "active" | "ended" | "cancelled"
  winner_ids: string[]
  created_at: string
  giveaway_entries: { count: number }[]
}

interface Props {
  serverId: string
}

export function GiveawayAppConfig({ serverId }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [giveaways, setGiveaways] = useState<Giveaway[]>([])
  const [savingChannel, setSavingChannel] = useState(false)

  // New giveaway form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newPrize, setNewPrize] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newDuration, setNewDuration] = useState("60")
  const [newWinners, setNewWinners] = useState("1")
  const [creating, setCreating] = useState(false)

  // Action confirmation
  const [pendingAction, setPendingAction] = useState<{ giveawayId: string; action: string; title: string } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [giveawayRes, channelsRes] = await Promise.all([
        fetch(`/api/servers/${serverId}/apps/giveaway`),
        fetch(`/api/servers/${serverId}/channels`),
      ])

      if (giveawayRes.ok) {
        const data = await giveawayRes.json()
        setChannelId(data.config?.channel_id || null)
        setGiveaways(data.giveaways || [])
      }

      if (channelsRes.ok) {
        const channelData = await channelsRes.json()
        setChannels(
          (Array.isArray(channelData) ? channelData : []).filter(
            (c: Channel) => c.type === "text"
          )
        )
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load giveaway config" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [serverId])

  async function saveChannel() {
    setSavingChannel(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/giveaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_channel", channel_id: channelId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      toast({ title: "Giveaway channel saved" })
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setSavingChannel(false)
    }
  }

  async function createGiveaway() {
    if (!newPrize.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/giveaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_giveaway",
          prize: newPrize.trim(),
          description: newDescription.trim() || undefined,
          duration_minutes: parseInt(newDuration) || 60,
          winners_count: parseInt(newWinners) || 1,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      toast({ title: "Giveaway created!" })
      setNewPrize("")
      setNewDescription("")
      setNewDuration("60")
      setNewWinners("1")
      setShowCreateForm(false)
      await load()
    } catch (err) {
      toast({ variant: "destructive", title: "Create failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setCreating(false)
    }
  }

  async function confirmAction() {
    if (!pendingAction) return
    setActionBusy(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/apps/giveaway/${pendingAction.giveawayId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pendingAction.action }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      toast({ title: `Giveaway ${pendingAction.action === "end" ? "ended" : pendingAction.action === "cancel" ? "cancelled" : "rerolled"}` })
      setPendingAction(null)
      await load()
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      setActionBusy(false)
    }
  }

  function formatTimeRemaining(endsAt: string) {
    const diff = new Date(endsAt).getTime() - Date.now()
    if (diff <= 0) return "Ended"
    const hours = Math.floor(diff / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  if (loading) {
    return <p style={{ color: "var(--theme-text-muted)" }}>Loading giveaway config...</p>
  }

  const activeGiveaways = giveaways.filter((g) => g.status === "active")
  const pastGiveaways = giveaways.filter((g) => g.status !== "active")

  return (
    <>
      <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.action === "end" ? "End giveaway?" : pendingAction?.action === "cancel" ? "Cancel giveaway?" : "Reroll winners?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.action === "end"
                ? `This will draw winners for "${pendingAction?.title}" immediately.`
                : pendingAction?.action === "cancel"
                  ? `This will cancel "${pendingAction?.title}" without drawing winners.`
                  : `This will select new random winners for "${pendingAction?.title}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction} disabled={actionBusy} className="motion-interactive">
              {actionBusy ? "Processing..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-5">
        <h4 className="text-md font-semibold" style={{ color: "var(--theme-text-bright)" }}>
          <Gift className="w-4 h-4 inline mr-1.5" />
          Giveaway Bot Configuration
        </h4>

        {/* Giveaway Channel */}
        <div className="space-y-1.5">
          <Label style={{ color: "var(--theme-text-muted)" }} className="text-sm">Giveaway Channel</Label>
          <div className="flex gap-2">
            <select
              value={channelId || ""}
              onChange={(e) => setChannelId(e.target.value || null)}
              className="flex-1 rounded px-3 py-2 text-sm"
              style={{
                background: "var(--theme-bg-primary)",
                color: "var(--theme-text-normal)",
                border: "1px solid var(--theme-surface-elevated)",
              }}
            >
              <option value="">Select a channel...</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}># {ch.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={saveChannel} disabled={savingChannel}>
              <Save className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            Giveaway announcements and results will be posted here.
          </p>
        </div>

        {/* Create Giveaway */}
        <div>
          {!showCreateForm ? (
            <Button size="sm" onClick={() => setShowCreateForm(true)} className="motion-interactive">
              <Gift className="w-4 h-4 mr-1.5" />
              Create Giveaway
            </Button>
          ) : (
            <div
              className="rounded border p-4 space-y-3"
              style={{ borderColor: "var(--theme-surface-elevated)", background: "var(--theme-bg-secondary)" }}
            >
              <p className="font-medium text-sm" style={{ color: "var(--theme-text-bright)" }}>
                New Giveaway
              </p>
              <div className="space-y-1.5">
                <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Prize *</Label>
                <Input
                  value={newPrize}
                  onChange={(e) => setNewPrize(e.target.value)}
                  placeholder="e.g. Discord Nitro, Steam Gift Card"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>Description</Label>
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Optional details about the giveaway"
                  maxLength={500}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
                    <Clock className="w-3 h-3 inline mr-1" />Duration (minutes)
                  </Label>
                  <Input
                    type="number"
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    min={1}
                    max={43200}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
                    <Users className="w-3 h-3 inline mr-1" />Winners
                  </Label>
                  <Input
                    type="number"
                    value={newWinners}
                    onChange={(e) => setNewWinners(e.target.value)}
                    min={1}
                    max={20}
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={createGiveaway} disabled={creating || !newPrize.trim()} className="motion-interactive">
                  {creating ? "Creating..." : "Start Giveaway"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Active Giveaways */}
        {activeGiveaways.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
              Active Giveaways ({activeGiveaways.length})
            </p>
            {activeGiveaways.map((g) => {
              const entryCount = g.giveaway_entries?.[0]?.count ?? 0
              return (
                <div
                  key={g.id}
                  className="rounded border p-3"
                  style={{ borderColor: "var(--theme-surface-elevated)" }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm" style={{ color: "var(--theme-text-bright)" }}>
                        <Trophy className="w-3.5 h-3.5 inline mr-1" style={{ color: "var(--theme-accent)" }} />
                        {g.prize}
                      </p>
                      {g.description && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-muted)" }}>{g.description}</p>
                      )}
                      <p className="text-xs mt-1" style={{ color: "var(--theme-text-muted)" }}>
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        {formatTimeRemaining(g.ends_at)} remaining ·
                        <Users className="w-3 h-3 inline mx-0.5" />
                        {entryCount} entries ·
                        {g.winners_count} winner{g.winners_count > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingAction({ giveawayId: g.id, action: "end", title: g.prize })}
                        title="End early & draw winners"
                      >
                        <Trophy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingAction({ giveawayId: g.id, action: "cancel", title: g.prize })}
                        title="Cancel giveaway"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Past Giveaways */}
        {pastGiveaways.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: "var(--theme-text-bright)" }}>
              Past Giveaways
            </p>
            {pastGiveaways.slice(0, 10).map((g) => (
              <div
                key={g.id}
                className="rounded border p-3 flex items-center justify-between"
                style={{
                  borderColor: "var(--theme-surface-elevated)",
                  opacity: g.status === "cancelled" ? 0.6 : 1,
                }}
              >
                <div>
                  <p className="text-sm" style={{ color: "var(--theme-text-normal)" }}>
                    {g.prize}
                    <span
                      className="ml-2 text-xs px-1.5 py-0.5 rounded"
                      style={{
                        background: g.status === "ended" ? "var(--theme-success, #43b581)" : "var(--theme-danger, #f04747)",
                        color: "#fff",
                      }}
                    >
                      {g.status}
                    </span>
                  </p>
                  {g.winner_ids.length > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
                      {g.winner_ids.length} winner{g.winner_ids.length > 1 ? "s" : ""} drawn
                    </p>
                  )}
                </div>
                {g.status === "ended" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingAction({ giveawayId: g.id, action: "reroll", title: g.prize })}
                    title="Reroll winners"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
