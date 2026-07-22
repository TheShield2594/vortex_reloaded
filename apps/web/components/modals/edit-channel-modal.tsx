"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import type { ChannelRow } from "@/types/database"

interface Props {
  open: boolean
  onClose: () => void
  channel: ChannelRow
}

/** Dialog for editing an existing channel's settings (name, topic, NSFW, slowmode, forum guidelines). */
export function EditChannelModal({ open, onClose, channel }: Props) {
  const { toast } = useToast()
  const { updateChannel } = useAppStore(
    useShallow((s) => ({ updateChannel: s.updateChannel }))
  )
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? "")
  const [nsfw, setNsfw] = useState(channel.nsfw)
  const [slowmodeDelay, setSlowmodeDelay] = useState(channel.slowmode_delay)
  const [forumGuidelines, setForumGuidelines] = useState(channel.forum_guidelines ?? "")
  const [streamUrl, setStreamUrl] = useState(channel.stream_url ?? "")

  // Reset form when channel changes or modal opens
  useEffect(() => {
    if (!open) return
    setName(channel.name)
    setTopic(channel.topic ?? "")
    setNsfw(channel.nsfw)
    setSlowmodeDelay(channel.slowmode_delay)
    setForumGuidelines(channel.forum_guidelines ?? "")
    setStreamUrl(channel.stream_url ?? "")
  }, [channel, open])

  async function handleSave() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        topic: topic.trim() || null,
        nsfw,
        slowmode_delay: slowmodeDelay,
      }

      if (channel.type === "forum") {
        body.forum_guidelines = forumGuidelines.trim() || null
      }

      if (channel.type === "stage") {
        body.stream_url = streamUrl.trim() || null
      }

      const res = await fetch(`/api/servers/${channel.server_id}/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to update channel" }))
        throw new Error(err.error || "Failed to update channel")
      }

      const updated = await res.json()
      updateChannel(channel.id, updated)
      toast({ title: "Channel updated" })
      onClose()
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to update channel",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
      })
    } finally {
      setLoading(false)
    }
  }

  const isForum = channel.type === "forum"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-md"
        style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Edit Channel</DialogTitle>
          <DialogDescription className="sr-only">Edit channel settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Channel Name */}
          <div>
            <Label htmlFor="edit-channel-name" className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-secondary)" }}>
              Channel Name
            </Label>
            <Input
              id="edit-channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="mt-1"
              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "none" }}
            />
          </div>

          {/* Topic */}
          {channel.type !== "category" && (
            <div>
              <Label htmlFor="edit-channel-topic" className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-secondary)" }}>
                Channel Topic
              </Label>
              <Input
                id="edit-channel-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What is this channel about?"
                maxLength={1024}
                className="mt-1"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "none" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--theme-text-faint)" }}>
                {topic.length}/1024
              </p>
            </div>
          )}

          {/* Forum Guidelines */}
          {isForum && (
            <div>
              <Label htmlFor="edit-channel-guidelines" className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-secondary)" }}>
                Post Guidelines
              </Label>
              <textarea
                id="edit-channel-guidelines"
                value={forumGuidelines}
                onChange={(e) => setForumGuidelines(e.target.value)}
                placeholder="Set rules and expectations for posts in this forum channel..."
                maxLength={2000}
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded text-sm focus:outline-none resize-none"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: forumGuidelines.length > 1900 ? "var(--theme-warning)" : "var(--theme-text-faint)" }}>
                {forumGuidelines.length}/2000
              </p>
            </div>
          )}

          {channel.type === "stage" && (
            <div>
              <Label htmlFor="edit-channel-stream-url" className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-secondary)" }}>
                YouTube Stream URL
              </Label>
              <Input
                id="edit-channel-stream-url"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "none" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--theme-text-faint)" }}>
                Members will see this embedded player in the Stage channel.
              </p>
            </div>
          )}

          {/* NSFW Toggle */}
          {channel.type !== "category" && (
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-white">Age-Restricted (NSFW)</Label>
                <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  Users must confirm their age before viewing this channel.
                </p>
              </div>
              <Switch checked={nsfw} onCheckedChange={setNsfw} />
            </div>
          )}

          {/* Slowmode */}
          {channel.type !== "category" && channel.type !== "voice" && (
            <div>
              <Label htmlFor="edit-channel-slowmode" className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-text-secondary)" }}>
                Slowmode (seconds)
              </Label>
              <Input
                id="edit-channel-slowmode"
                type="number"
                min={0}
                max={21600}
                value={slowmodeDelay}
                onChange={(e) => setSlowmodeDelay(Math.max(0, Math.min(21600, parseInt(e.target.value) || 0)))}
                className="mt-1"
                style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "none" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--theme-text-faint)" }}>
                0 = disabled. Max: 21600 (6 hours).
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose} style={{ color: "var(--theme-text-secondary)" }}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
