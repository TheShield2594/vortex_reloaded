"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Hash, Volume2, FolderOpen, MessageSquare, Mic2, Megaphone, Image, Clock } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import type { ChannelType } from "@vortex/shared"

/** Available expiry durations in seconds → human label */
const EXPIRY_OPTIONS: { label: string; seconds: number }[] = [
  { label: "1 hour",   seconds: 60 * 60 },
  { label: "6 hours",  seconds: 6 * 60 * 60 },
  { label: "12 hours", seconds: 12 * 60 * 60 },
  { label: "1 day",    seconds: 24 * 60 * 60 },
  { label: "3 days",   seconds: 3 * 24 * 60 * 60 },
  { label: "1 week",   seconds: 7 * 24 * 60 * 60 },
]

interface Props {
  open: boolean
  onClose: () => void
  serverId: string
  categoryId?: string
}

/** Dialog for creating a new channel within a server, supporting text, voice, forum, announcement, media, and temporary channel types. */
export function CreateChannelModal({ open, onClose, serverId, categoryId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const { addChannel } = useAppStore(
    useShallow((s) => ({ addChannel: s.addChannel }))
  )
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<ChannelType>("text")
  const [isTemporary, setIsTemporary] = useState(false)
  const [expirySeconds, setExpirySeconds] = useState(EXPIRY_OPTIONS[3].seconds) // default 1 day
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  function resetForm() {
    setName("")
    setType("text")
    setIsTemporary(false)
    setExpirySeconds(EXPIRY_OPTIONS[3].seconds)
    onClose()
  }

  async function handleCreate() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const channelName = type === "category"
        ? name.trim()
        : name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")

      const { data: existing, error: checkError } = await supabase
        .from("channels")
        .select("id")
        .eq("server_id", serverId)
        .eq("name", channelName)
        .eq("type", type)
        .maybeSingle()

      if (checkError) throw checkError
      if (existing) {
        throw new Error(`A ${type} channel named "${channelName}" already exists.`)
      }

      const expiresAt = isTemporary && type !== "category"
        ? new Date(Date.now() + expirySeconds * 1000).toISOString()
        : null

      const { data: channel, error } = await supabase
        .from("channels")
        .insert({
          server_id: serverId,
          name: channelName,
          type,
          parent_id: categoryId || null,
          expires_at: expiresAt,
        })
        .select()
        .single()

      if (error) throw error

      addChannel(channel)
      toast({ title: `Channel #${channel.name} created!` })
      resetForm()

      if (type !== "voice" && type !== "category") {
        router.push(`/channels/${serverId}/${channel.id}`)
      }
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to create channel", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  const channelTypes: { type: ChannelType; label: string; description: string; icon: React.ReactNode }[] = [
    {
      type: "text",
      label: "Text",
      description: "Send messages, images, GIFs, emoji, and more",
      icon: <Hash className="w-5 h-5" />,
    },
    {
      type: "announcement",
      label: "Announcement",
      description: "Post important updates; members can follow to other servers",
      icon: <Megaphone className="w-5 h-5" />,
    },
    {
      type: "forum",
      label: "Forum",
      description: "Create organized threads for focused discussions",
      icon: <MessageSquare className="w-5 h-5" />,
    },
    {
      type: "media",
      label: "Media",
      description: "Share and browse images, videos, and files",
      icon: <Image className="w-5 h-5" />,
    },
    {
      type: "voice",
      label: "Voice",
      description: "Hang out together with voice and video",
      icon: <Volume2 className="w-5 h-5" />,
    },
    {
      type: "stage",
      label: "Stage",
      description: "Broadcast to an audience with speaker controls",
      icon: <Mic2 className="w-5 h-5" />,
    },
    {
      type: "category",
      label: "Category",
      description: "Organize channels into groups",
      icon: <FolderOpen className="w-5 h-5" />,
    },
  ]

  function getInputIcon() {
    switch (type) {
      case "voice": return <Volume2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
      case "forum": return <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
      case "announcement": return <Megaphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
      case "media": return <Image className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
      case "stage": return <Mic2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
      default: return <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
    }
  }

  return (
    <Dialog open={open} onOpenChange={resetForm}>
      <DialogContent style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-bg-tertiary)', maxWidth: '460px' }}>
        <DialogHeader>
          <DialogTitle className="text-white">Create Channel</DialogTitle>
          <DialogDescription className="sr-only">Create a new channel in this server</DialogDescription>
          {categoryId && (
            <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>in a category</p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider mb-3 block" style={{ color: 'var(--theme-text-secondary)' }}>
              Channel Type
            </Label>
            <div className="space-y-2">
              {channelTypes.map(({ type: t, label, description, icon }) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className="w-full flex items-center gap-3 p-3 rounded cursor-pointer transition-colors text-left"
                  style={{
                    background: type === t ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)',
                    border: `1px solid ${type === t ? 'var(--theme-accent)' : 'transparent'}`,
                  }}
                >
                  <span style={{ color: type === t ? 'white' : 'var(--theme-text-muted)' }}>{icon}</span>
                  <div>
                    <div className="font-medium text-white text-sm">{label}</div>
                    <div className="text-xs" style={{ color: type === t ? 'rgba(255,255,255,0.7)' : 'var(--theme-text-muted)' }}>
                      {description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-secondary)' }}>
              Channel Name <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              {type !== "category" && getInputIcon()}
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  type === "category" ? "New Category" :
                  type === "voice" ? "general" :
                  type === "stage" ? "town-hall" :
                  type === "forum" ? "help-forum" :
                  type === "announcement" ? "announcements" :
                  type === "media" ? "media-gallery" :
                  "new-channel"
                }
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                required
                aria-required="true"
                aria-invalid={name.length > 0 && !name.trim()}
                className={type !== "category" ? "pl-8" : ""}
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
              />
            </div>
          </div>

          {/* Temporary channel toggle (not available for categories) */}
          {type !== "category" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
                  <div>
                    <Label className="text-sm font-medium text-white cursor-pointer" htmlFor="temporary-toggle">
                      Ephemeral Channel
                    </Label>
                    <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                      Auto-delete this channel after a set time
                    </p>
                  </div>
                </div>
                <Switch
                  id="temporary-toggle"
                  checked={isTemporary}
                  onCheckedChange={setIsTemporary}
                />
              </div>

              {isTemporary && (
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: 'var(--theme-text-secondary)' }}>
                    Delete after
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {EXPIRY_OPTIONS.map(({ label, seconds }) => (
                      <button
                        key={seconds}
                        onClick={() => setExpirySeconds(seconds)}
                        className="py-1.5 px-2 rounded text-sm font-medium transition-colors"
                        style={{
                          background: expirySeconds === seconds ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)',
                          color: expirySeconds === seconds ? 'white' : 'var(--theme-text-muted)',
                          border: `1px solid ${expirySeconds === seconds ? 'var(--theme-accent)' : 'transparent'}`,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={resetForm}
              className="flex-1"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="flex-1"
              style={{ background: 'var(--theme-accent)' }}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Channel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
