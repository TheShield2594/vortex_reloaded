"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useConnectionsCallback } from "@/hooks/use-connections-callback"
import { Loader2, Upload, Camera, ExternalLink, Link2, Check, Hash, Plus, Trash2, GripVertical, Globe, Users, Lock } from "lucide-react"
import { SteamIcon, YouTubeIcon } from "@/components/icons/social-icons"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useToast } from "@/components/ui/use-toast"
import type { UserRow, UserPinnedItemRow } from "@/types/database"
import { STATUS_OPTIONS } from "@/lib/utils/status-options"

interface Props {
  user: UserRow
}

const BANNER_PRESETS = [
  "#5865f2", "#eb459e", "#fee75c", "#57f287", "#ed4245",
  "#3ba55c", "#faa61a", "#7289da", "#2c2f33", "#99aab5",
]

export function ProfileSettingsPage({ user }: Props) {
  const { toast } = useToast()
  const router = useRouter()

  const [supabase] = useState(() => createClientSupabaseClient())
  const { setCurrentUser } = useAppStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(user.display_name ?? "")
  const [bio, setBio] = useState(user.bio ?? "")
  const [customTag, setCustomTag] = useState(user.custom_tag ?? "")
  const [bannerColor, setBannerColor] = useState(user.banner_color ?? "#5865f2")
  const [status, setStatus] = useState<"online" | "idle" | "dnd" | "invisible">(
    (user.status as "online" | "idle" | "dnd" | "invisible") ?? "online"
  )
  const [statusMessage, setStatusMessage] = useState(user.status_message ?? "")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [connections, setConnections] = useState<Array<{ id: string; provider: string; provider_user_id: string; username: string | null; display_name: string | null; profile_url: string | null }>>([])
  const [activeConnectionPrompt, setActiveConnectionPrompt] = useState<"steam" | "youtube" | null>(null)

  // Interests / Tags
  const [interests, setInterests] = useState<string[]>(user.interests ?? [])
  const [interestInput, setInterestInput] = useState("")
  const [interestSaving, setInterestSaving] = useState(false)
  const MAX_TAGS = 15
  const TAG_REGEX = /^[a-z0-9][a-z0-9\-]*[a-z0-9]?$/

  // Pinned Items
  const [pins, setPins] = useState<UserPinnedItemRow[]>([])
  const [pinsLoading, setPinsLoading] = useState(true)
  const [newPin, setNewPin] = useState<{ pin_type: UserPinnedItemRow["pin_type"]; label: string; sublabel: string; url: string }>({
    pin_type: "link", label: "", sublabel: "", url: "",
  })
  const [pinSaving, setPinSaving] = useState(false)
  const MAX_PINS = 6

  // Activity visibility
  const [activityVisibility, setActivityVisibility] = useState<"public" | "friends" | "private">(
    (user.activity_visibility as "public" | "friends" | "private") ?? "public"
  )
  const [visibilitySaving, setVisibilitySaving] = useState(false)

  const loadConnections = useCallback(async () => {
    const res = await fetch("/api/users/connections", { cache: "no-store" })
    const payload = await res.json().catch(() => ({}))
    if (res.ok) {
      setConnections(payload.connections ?? [])
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  useConnectionsCallback(loadConnections, toast, router)

  useEffect(() => {
    setPinsLoading(true)
    fetch("/api/users/pinned")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { pins: UserPinnedItemRow[] }) => setPins(json.pins ?? []))
      .catch(() => { /* silently fail — empty state shown */ })
      .finally(() => setPinsLoading(false))
  }, [])

  const addInterestTag = useCallback(() => {
    const tag = interestInput.trim().toLowerCase()
    if (!tag) return
    if (tag.length > 30) {
      toast({ variant: "destructive", title: "Tag too long", description: "Max 30 characters." })
      return
    }
    if (tag.length === 1 && !/^[a-z0-9]$/.test(tag)) {
      toast({ variant: "destructive", title: "Invalid tag", description: "Use letters, numbers, and hyphens only." })
      return
    }
    if (tag.length > 1 && !TAG_REGEX.test(tag)) {
      toast({ variant: "destructive", title: "Invalid tag", description: "Use lowercase letters, numbers, and hyphens only." })
      return
    }
    if (interests.includes(tag)) {
      toast({ variant: "destructive", title: "Duplicate tag" })
      return
    }
    if (interests.length >= MAX_TAGS) {
      toast({ variant: "destructive", title: `Maximum ${MAX_TAGS} interests allowed` })
      return
    }
    setInterests((prev) => [...prev, tag])
    setInterestInput("")
  }, [interestInput, interests, toast])

  async function saveInterests() {
    setInterestSaving(true)
    try {
      const res = await fetch("/api/users/interests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to save interests")
      }
      toast({ title: "Interests saved!" })
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Error saving interests" })
    } finally {
      setInterestSaving(false)
    }
  }

  async function addPin() {
    if (!newPin.label.trim()) {
      toast({ variant: "destructive", title: "Label is required" })
      return
    }
    setPinSaving(true)
    try {
      const res = await fetch("/api/users/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin_type: newPin.pin_type,
          label: newPin.label.trim(),
          sublabel: newPin.sublabel.trim() || null,
          url: newPin.url.trim() || null,
          position: pins.length,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to add pin")
      setPins((prev) => [...prev, data.pin])
      setNewPin({ pin_type: "link", label: "", sublabel: "", url: "" })
      toast({ title: "Pin added!" })
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Error adding pin" })
    } finally {
      setPinSaving(false)
    }
  }

  async function removePin(pinId: string) {
    try {
      const res = await fetch(`/api/users/pinned?id=${pinId}`, { method: "DELETE" })
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to remove pin" })
        return
      }
      setPins((prev) => prev.filter((p) => p.id !== pinId))
    } catch {
      toast({ variant: "destructive", title: "Failed to remove pin" })
    }
  }

  async function saveActivityVisibility(value: "public" | "friends" | "private") {
    setActivityVisibility(value)
    setVisibilitySaving(true)
    try {
      const res = await fetch("/api/users/activity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: value }),
      })
      if (!res.ok) throw new Error("Failed to update visibility")
      toast({ title: "Activity visibility updated" })
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Error" })
    } finally {
      setVisibilitySaving(false)
    }
  }

  // Revoke object URLs when preview changes or component unmounts
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    }
  }, [avatarPreview])

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Image too large", description: "Max 5MB." })
      return
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function handleSave() {
    setSaving(true)
    try {
      let avatarUrl = user.avatar_url

      if (avatarFile) {
        const ALLOWED_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"])
        const rawExt = avatarFile.name.split(".").pop()?.toLowerCase() ?? ""
        const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : "jpg"
        const path = `${user.id}/avatar.${ext}`
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path)
        avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`
      }

      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName || null,
          bio: bio || null,
          custom_tag: customTag || null,
          banner_color: bannerColor,
          status,
          status_message: statusMessage || null,
          avatar_url: avatarUrl,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to save")
      }

      const updated = await res.json()
      setCurrentUser(updated)
      toast({ title: "Profile saved!" })
      router.refresh()
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to save profile",
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setSaving(false)
    }
  }

  async function connectSteam() {
    const next = window.location.pathname + window.location.search
    window.location.href = `/api/users/connections/steam/start?next=${encodeURIComponent(next)}`
  }

  async function connectYouTube() {
    const next = window.location.pathname + window.location.search
    window.location.href = `/api/users/connections/youtube/start?next=${encodeURIComponent(next)}`
  }

  async function removeConnection(id: string) {
    try {
      const res = await fetch(`/api/users/connections?id=${id}`, { method: "DELETE" })
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to remove connection" })
        return
      }
      setConnections((prev) => prev.filter((item) => item.id !== id))
    } catch {
      toast({ variant: "destructive", title: "Failed to remove connection" })
    }
  }

  const steamConnection = connections.find((item) => item.provider === "steam")
  const youtubeConnection = connections.find((item) => item.provider === "youtube")
  const initials = (user.display_name || user.username || "?").slice(0, 2).toUpperCase()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--theme-text-bright)" }}>
          My Profile
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>
          Update your identity, status, and profile details.
        </p>
      </div>

      {/* Avatar section */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Avatar
        </h2>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Avatar className="w-20 h-20">
              {(avatarPreview ?? user.avatar_url) && (
                <AvatarImage src={avatarPreview ?? user.avatar_url!} alt="Avatar" />
              )}
              <AvatarFallback
                className="text-2xl font-bold"
                style={{ background: bannerColor, color: "white" }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: "rgba(0,0,0,0.6)" }}
              aria-label="Change avatar"
            >
              <Camera className="w-5 h-5 text-white" />
            </button>
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors hover:brightness-110"
              style={{ background: "var(--theme-accent)", color: "white" }}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload image
            </button>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>JPG, PNG, GIF, WebP — max 5MB</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
      </section>

      {/* Identity */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Identity
        </h2>

        <div className="space-y-2">
          <label htmlFor="profile-display-name" className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>
            Display Name
          </label>
          <input
            id="profile-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={32}
            className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2"
            style={{
              background: "var(--theme-surface-input)",
              color: "var(--theme-text-primary)",
              border: "1px solid var(--theme-bg-tertiary)",
            }}
            placeholder={user.username}
          />
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
            Username: @{user.username}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-custom-tag" className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>
            Custom Tag
          </label>
          <input
            id="profile-custom-tag"
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
            maxLength={16}
            className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2"
            style={{
              background: "var(--theme-surface-input)",
              color: "var(--theme-text-primary)",
              border: "1px solid var(--theme-bg-tertiary)",
            }}
            placeholder="e.g. gamer"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-about-me" className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>
            About Me
          </label>
          <textarea
            id="profile-about-me"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={190}
            rows={3}
            className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2 resize-none"
            style={{
              background: "var(--theme-surface-input)",
              color: "var(--theme-text-primary)",
              border: "1px solid var(--theme-bg-tertiary)",
            }}
            placeholder="Tell people a bit about yourself…"
          />
          <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{bio.length}/190</p>
        </div>
      </section>

      {/* Banner color */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Banner Color
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {BANNER_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setBannerColor(color)}
              className="w-8 h-8 rounded-full transition-transform hover:scale-110 focus-ring"
              style={{
                background: color,
                outline: bannerColor === color ? `3px solid white` : "none",
                outlineOffset: "2px",
              }}
              aria-label={`Select color ${color}`}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={bannerColor}
              onChange={(e) => setBannerColor(e.target.value)}
              className="w-8 h-8 rounded-full cursor-pointer border-0 bg-transparent"
              title="Custom banner color"
              aria-label="Custom banner color"
            />
            <span className="text-xs font-mono" style={{ color: "var(--theme-text-muted)" }}>{bannerColor}</span>
          </div>
        </div>
      </section>

      {/* Status */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Status
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map(({ value, label, color }) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all focus-ring"
              style={{
                background: status === value ? "color-mix(in srgb, var(--theme-accent) 15%, var(--theme-bg-secondary))" : "var(--theme-bg-secondary)",
                border: `1px solid ${status === value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`,
                color: "var(--theme-text-primary)",
                fontWeight: status === value ? 600 : 400,
              }}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label htmlFor="profile-status-message" className="text-sm font-medium" style={{ color: "var(--theme-text-primary)" }}>
            Status Message
          </label>
          <input
            id="profile-status-message"
            type="text"
            value={statusMessage}
            onChange={(e) => setStatusMessage(e.target.value)}
            maxLength={128}
            className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2"
            style={{
              background: "var(--theme-surface-input)",
              color: "var(--theme-text-primary)",
              border: "1px solid var(--theme-bg-tertiary)",
            }}
            placeholder="What's happening?"
          />
        </div>
      </section>

      {/* Save */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Connections & Social Links
        </h2>

        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Click a service to connect it to your profile.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveConnectionPrompt("steam")}
            className="h-14 w-14 rounded-lg flex items-center justify-center transition-all hover:brightness-110 focus-ring relative"
            style={{
              background: "var(--theme-bg-secondary)",
              border: `1px solid ${steamConnection ? "var(--theme-success)" : "var(--theme-bg-tertiary)"}`,
              color: "var(--theme-text-primary)",
            }}
            aria-label={steamConnection ? "Manage Steam connection" : "Connect Steam"}
          >
            <SteamIcon className="w-6 h-6" />
            {steamConnection && (
              <span className="absolute -top-1 -right-1 rounded-full p-0.5" style={{ background: "var(--theme-success)", color: "white" }}>
                <Check className="w-3 h-3" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveConnectionPrompt("youtube")}
            className="h-14 w-14 rounded-lg flex items-center justify-center transition-all hover:brightness-110 focus-ring relative"
            style={{
              background: "var(--theme-bg-secondary)",
              border: `1px solid ${youtubeConnection ? "var(--theme-success)" : "var(--theme-bg-tertiary)"}`,
              color: "var(--theme-text-primary)",
            }}
            aria-label={youtubeConnection ? "Manage YouTube connection" : "Connect YouTube"}
          >
            <YouTubeIcon className="w-6 h-6" />
            {youtubeConnection && (
              <span className="absolute -top-1 -right-1 rounded-full p-0.5" style={{ background: "var(--theme-success)", color: "white" }}>
                <Check className="w-3 h-3" />
              </span>
            )}
          </button>
        </div>

        {activeConnectionPrompt === "steam" && (
          <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>Steam</h3>
              <button type="button" className="text-xs" style={{ color: "var(--theme-text-muted)" }} onClick={() => setActiveConnectionPrompt(null)}>Close</button>
            </div>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Steam uses OpenID sign-in and does not require entering a username here.</p>
            {steamConnection && <p className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>Connected as {steamConnection.display_name || steamConnection.username || steamConnection.provider_user_id}</p>}
            <button type="button" onClick={connectSteam} className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium" style={{ background: "var(--theme-accent)", color: "white" }}>
              <Link2 className="w-4 h-4" /> {steamConnection ? "Reconnect Steam" : "Connect Steam"}
            </button>
          </div>
        )}

        {activeConnectionPrompt === "youtube" && (
          <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>YouTube</h3>
              <button type="button" className="text-xs" style={{ color: "var(--theme-text-muted)" }} onClick={() => setActiveConnectionPrompt(null)}>Close</button>
            </div>
            <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>Sign in with Google to link your YouTube channel. We only read your channel name and stats.</p>
            {youtubeConnection && <p className="text-xs" style={{ color: "var(--theme-text-secondary)" }}>Connected as {youtubeConnection.display_name || youtubeConnection.username || youtubeConnection.provider_user_id}</p>}
            <button type="button" onClick={connectYouTube} className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium" style={{ background: "var(--theme-accent)", color: "white" }}>
              <Link2 className="w-4 h-4" /> {youtubeConnection ? "Reconnect YouTube" : "Connect YouTube"}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {connections.map((connection) => (
            <div key={connection.id} className="rounded-lg p-3 flex items-center justify-between gap-3" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
              <div className="min-w-0">
                <p className="text-sm capitalize" style={{ color: "var(--theme-text-primary)" }}>{connection.provider}</p>
                <p className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>{connection.display_name || connection.username || connection.provider_user_id}</p>
              </div>
              <div className="flex items-center gap-2">
                {connection.profile_url && (
                  <a href={connection.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded p-1.5" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-secondary)" }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button type="button" onClick={() => removeConnection(connection.id)} className="text-xs font-medium" style={{ color: "var(--theme-danger)" }}>Remove</button>
              </div>
            </div>
          ))}
          {connections.length === 0 && <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>No connections yet.</p>}
        </div>
      </section>

      {/* ── Interests / Tags ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
            Interests
          </h2>
          <button
            type="button"
            onClick={saveInterests}
            disabled={interestSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:brightness-110 disabled:opacity-60"
            style={{ background: "var(--theme-accent)", color: "white" }}
          >
            {interestSaving && <Loader2 className="w-3 h-3 animate-spin" />}
            Save interests
          </button>
        </div>

        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Add up to {MAX_TAGS} tags. Use lowercase letters, numbers, and hyphens — e.g.{" "}
          <span style={{ color: "var(--theme-text-secondary)" }}>gaming, ai, self-hosting</span>
        </p>

        {/* Tag input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Hash
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
              style={{ color: "var(--theme-text-muted)" }}
              aria-hidden
            />
            <input
              type="text"
              value={interestInput}
              onChange={(e) => setInterestInput(e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault()
                  addInterestTag()
                }
              }}
              maxLength={30}
              placeholder="minecraft"
              disabled={interests.length >= MAX_TAGS}
              className="w-full pl-8 pr-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2"
              style={{
                background: "var(--theme-surface-input)",
                color: "var(--theme-text-primary)",
                border: "1px solid var(--theme-bg-tertiary)",
              }}
              aria-label="Add interest tag"
            />
          </div>
          <button
            type="button"
            onClick={addInterestTag}
            disabled={!interestInput.trim() || interests.length >= MAX_TAGS}
            className="flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
            aria-label="Add tag"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        {/* Tag pills */}
        {interests.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="Your interests">
            {interests.map((tag) => (
              <span
                key={tag}
                role="listitem"
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium"
                style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-text-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
              >
                <Hash className="w-2.5 h-2.5" aria-hidden />
                {tag}
                <button
                  type="button"
                  onClick={() => setInterests((prev) => prev.filter((t) => t !== tag))}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                  aria-label={`Remove ${tag}`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                    <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>No interests added yet.</p>
        )}
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{interests.length}/{MAX_TAGS}</p>
      </section>

      {/* ── Pinned Items ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Pinned Items
        </h2>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Pin up to {MAX_PINS} items — messages, channels, files, or links — to your profile.
        </p>

        {/* Existing pins */}
        {pinsLoading ? (
          <div className="space-y-2">
            {[1, 2].map((n) => (
              <div key={n} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--theme-bg-secondary)" }} />
            ))}
          </div>
        ) : pins.length > 0 ? (
          <div className="space-y-1.5" role="list" aria-label="Pinned items">
            {pins.map((pin) => (
              <div
                key={pin.id}
                role="listitem"
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}
              >
                <GripVertical className="w-3.5 h-3.5 flex-shrink-0 opacity-40" style={{ color: "var(--theme-text-muted)" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--theme-text-primary)" }}>{pin.label}</p>
                  {pin.sublabel && <p className="text-[11px] truncate" style={{ color: "var(--theme-text-muted)" }}>{pin.sublabel}</p>}
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded capitalize" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>
                  {pin.pin_type}
                </span>
                <button
                  type="button"
                  onClick={() => removePin(pin.id)}
                  className="p-1 rounded hover:bg-red-500/20 transition-colors"
                  style={{ color: "var(--theme-danger)" }}
                  aria-label={`Remove pin: ${pin.label}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>Nothing pinned yet.</p>
        )}

        {/* Add new pin — only shown when under the limit */}
        {pins.length < MAX_PINS && (
          <div className="rounded-lg p-3 space-y-2.5" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--theme-text-secondary)" }}>Add a pin</p>

            <div className="grid grid-cols-2 gap-2">
              {(["link", "message", "channel", "file"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setNewPin((prev) => ({ ...prev, pin_type: type }))}
                  className="py-1.5 rounded text-xs font-medium capitalize transition-all"
                  style={{
                    background: newPin.pin_type === type ? "color-mix(in srgb, var(--theme-accent) 15%, var(--theme-bg-tertiary))" : "var(--theme-bg-tertiary)",
                    border: `1px solid ${newPin.pin_type === type ? "var(--theme-accent)" : "transparent"}`,
                    color: newPin.pin_type === type ? "var(--theme-accent)" : "var(--theme-text-muted)",
                  }}
                >
                  {type}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={newPin.label}
              onChange={(e) => setNewPin((prev) => ({ ...prev, label: e.target.value }))}
              maxLength={120}
              placeholder="Label (required)"
              className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus:ring-2"
              style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
            />
            <input
              type="text"
              value={newPin.sublabel}
              onChange={(e) => setNewPin((prev) => ({ ...prev, sublabel: e.target.value }))}
              maxLength={80}
              placeholder="Sublabel — e.g. channel name (optional)"
              className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus:ring-2"
              style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
            />
            <input
              type="url"
              value={newPin.url}
              onChange={(e) => setNewPin((prev) => ({ ...prev, url: e.target.value }))}
              maxLength={2000}
              placeholder="URL (optional)"
              className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus:ring-2"
              style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
            />

            <button
              type="button"
              onClick={addPin}
              disabled={pinSaving || !newPin.label.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all hover:brightness-110 disabled:opacity-60"
              style={{ background: "var(--theme-accent)", color: "white" }}
            >
              {pinSaving && <Loader2 className="w-3 h-3 animate-spin" />}
              <Plus className="w-3 h-3" />
              Add pin
            </button>
          </div>
        )}
      </section>

      {/* ── Activity Privacy ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
          Activity Privacy
        </h2>
        <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
          Control who can see your recent activity feed on your profile.
        </p>

        <div className="grid grid-cols-3 gap-2">
          {([
            { value: "public" as const, label: "Public", icon: <Globe className="w-4 h-4" />, description: "Anyone" },
            { value: "friends" as const, label: "Friends", icon: <Users className="w-4 h-4" />, description: "Friends only" },
            { value: "private" as const, label: "Private", icon: <Lock className="w-4 h-4" />, description: "Only you" },
          ]).map(({ value, label, icon, description }) => (
            <button
              key={value}
              type="button"
              onClick={() => saveActivityVisibility(value)}
              disabled={visibilitySaving}
              className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-all disabled:opacity-60"
              style={{
                background: activityVisibility === value
                  ? "color-mix(in srgb, var(--theme-accent) 15%, var(--theme-bg-secondary))"
                  : "var(--theme-bg-secondary)",
                border: `1px solid ${activityVisibility === value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`,
                color: activityVisibility === value ? "var(--theme-accent)" : "var(--theme-text-muted)",
              }}
              aria-pressed={activityVisibility === value}
            >
              {icon}
              <span>{label}</span>
              <span className="font-normal opacity-70">{description}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Save ── */}
      <div className="flex items-center justify-end pt-2 pb-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-md font-semibold text-sm transition-all hover:brightness-110 disabled:opacity-60"
          style={{ background: "var(--theme-accent)", color: "white" }}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  )
}
