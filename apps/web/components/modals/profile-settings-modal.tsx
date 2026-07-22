"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useLazyEmojiPicker } from "@/hooks/use-lazy-emoji-picker"
import { useMobileLayout } from "@/hooks/use-mobile-layout"
import { Loader2, Upload, LogOut, Lock, Hash, Plus, GripVertical, Globe, Users, Trash2, X } from "lucide-react"
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import type { UserRow, UserPinnedItemRow } from "@/types/database"
import { STATUS_OPTIONS } from "@/lib/utils/status-options"
import { ConnectionsSection } from "@/components/settings/security/connections-section"
import { PasskeysSection } from "@/components/settings/security/passkeys-section"
import { SecurityPolicySection } from "@/components/settings/security/security-policy-section"
import { PasswordChangeSection } from "@/components/settings/security/password-change-section"
import { RecoveryCodesSection } from "@/components/settings/security/recovery-codes-section"
import { SessionManagementSection } from "@/components/settings/security/session-management-section"
import { TwoFactorSection } from "@/components/settings/security/two-factor-section"
import { AppearanceTab } from "@/components/settings/appearance/appearance-tab"

interface Props {
  open: boolean
  onClose: () => void
  user: UserRow
}

const BANNER_PRESETS = [
  "#5865f2", "#eb459e", "#fee75c", "#57f287", "#ed4245",
  "#3ba55c", "#faa61a", "#7289da", "#2c2f33", "#99aab5",
]

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const MAX_AVATAR_SIZE = 5 * 1024 * 1024 // 5MB

const STATUS_EXPIRY_OPTIONS = [
  { key: "never", label: "Never expires", minutes: null },
  { key: "30m", label: "In 30 minutes", minutes: 30 },
  { key: "1h", label: "In 1 hour", minutes: 60 },
  { key: "4h", label: "In 4 hours", minutes: 240 },
  { key: "1d", label: "In 1 day", minutes: 1440 },
  { key: "custom", label: "Custom…", minutes: null },
] as const

type StatusExpiryKey = (typeof STATUS_EXPIRY_OPTIONS)[number]["key"]

function inferStatusExpiryKey(value: string | null | undefined): { key: StatusExpiryKey; expired: boolean; customMinutes?: number } {
  if (!value) return { key: "never", expired: false }
  const expiryMs = new Date(value).getTime()
  if (Number.isNaN(expiryMs)) return { key: "never", expired: false }
  const diffMinutes = Math.round((expiryMs - Date.now()) / 60000)
  if (diffMinutes <= 0) return { key: "never", expired: true }

  const timedOptions = STATUS_EXPIRY_OPTIONS.filter((option) => option.minutes !== null)
  const closest = [...timedOptions].sort((a, b) => Math.abs((a.minutes ?? 0) - diffMinutes) - Math.abs((b.minutes ?? 0) - diffMinutes))[0]

  // If the closest preset is more than 5 minutes off, treat as custom
  if (closest && Math.abs((closest.minutes ?? 0) - diffMinutes) > 5) {
    return { key: "custom" as StatusExpiryKey, expired: false, customMinutes: diffMinutes }
  }

  return { key: (closest?.key ?? "never") as StatusExpiryKey, expired: false }
}

function getStatusExpiryIso(key: StatusExpiryKey, customMinutes?: number): string {
  if (key === "custom") {
    if (!customMinutes || customMinutes <= 0) return ""
    return new Date(Date.now() + customMinutes * 60 * 1000).toISOString()
  }
  const option = STATUS_EXPIRY_OPTIONS.find((entry) => entry.key === key)
  if (!option || option.minutes === null) return ""
  return new Date(Date.now() + option.minutes * 60 * 1000).toISOString()
}

function SortablePinItem({ pin, onRemove }: { pin: UserPinnedItemRow; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: "var(--theme-bg-secondary)",
    border: "1px solid var(--theme-bg-tertiary)",
  }
  return (
    <div ref={setNodeRef} style={style} role="listitem" className="flex items-center gap-2 px-3 py-2 rounded-lg">
      <button type="button" {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none p-0 border-0 bg-transparent" aria-label={`Drag to reorder: ${pin.label}`}>
        <GripVertical className="w-3.5 h-3.5 flex-shrink-0 opacity-40" style={{ color: "var(--theme-text-muted)" }} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: "var(--theme-text-primary)" }}>{pin.label}</p>
        {pin.sublabel && <p className="text-[11px] truncate" style={{ color: "var(--theme-text-muted)" }}>{pin.sublabel}</p>}
      </div>
      <span className="text-[10px] px-1.5 py-0.5 rounded capitalize" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-muted)" }}>{pin.pin_type}</span>
      <button type="button" onClick={() => onRemove(pin.id)} className="p-1 rounded hover:bg-red-500/20 transition-colors" style={{ color: "var(--theme-danger)" }} aria-label={`Remove pin: ${pin.label}`}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/** Tabbed user settings dialog covering profile editing, account security (2FA, passkeys, sessions), and appearance preferences. */
export function ProfileSettingsModal({ open, onClose, user }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const isMobile = useMobileLayout()
  const { setCurrentUser } = useAppStore(
    useShallow((s) => ({ setCurrentUser: s.setCurrentUser }))
  )
  const [loading, setLoading] = useState(false)
  const [displayName, setDisplayName] = useState(user.display_name ?? "")
  const [username, setUsername] = useState(user.username)
  const [bio, setBio] = useState(user.bio ?? "")
  const [customTag, setCustomTag] = useState(user.custom_tag ?? "")
  const [statusMessage, setStatusMessage] = useState(user.status_message ?? "")
  const [statusEmoji, setStatusEmoji] = useState(user.status_emoji ?? "")
  const [statusExpiryKey, setStatusExpiryKey] = useState<StatusExpiryKey>(() => {
    const { key } = inferStatusExpiryKey(user.status_expires_at)
    return key
  })
  const [customExpiryHours, setCustomExpiryHours] = useState<number>(() => {
    const { customMinutes } = inferStatusExpiryKey(user.status_expires_at)
    return customMinutes ? Math.floor(customMinutes / 60) : 0
  })
  const [customExpiryMinutes, setCustomExpiryMinutes] = useState<number>(() => {
    const { customMinutes } = inferStatusExpiryKey(user.status_expires_at)
    return customMinutes ? customMinutes % 60 : 30
  })
  const [statusExpiryDirty, setStatusExpiryDirty] = useState(false)

  // Clear expired status on mount
  useEffect(() => {
    const { expired } = inferStatusExpiryKey(user.status_expires_at)
    if (expired) {
      fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_expires_at: null }),
      }).catch((err) => {
        console.error("Failed to clear expired status:", err)
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [status, setStatus] = useState(user.status)
  const [bannerColor, setBannerColor] = useState(user.banner_color ?? "#5865f2")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "connections" | "appearance">("profile")
  const [showStatusEmojiPicker, setShowStatusEmojiPickerRaw] = useState(false)
  const { EmojiPicker, loadEmojiPicker } = useLazyEmojiPicker()
  const setShowStatusEmojiPicker = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v : () => v
    setShowStatusEmojiPickerRaw((prev) => {
      const val = next(prev)
      if (val) loadEmojiPicker()
      return val
    })
  }, [loadEmojiPicker])
  const statusEmojiPickerRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLInputElement>(null)

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

  // Load pinned items
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPinsLoading(true)
    fetch("/api/users/pinned")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { pins: UserPinnedItemRow[] }) => {
        if (!cancelled) setPins(json.pins ?? [])
      })
      .catch(() => { /* silently fail — empty state shown */ })
      .finally(() => { if (!cancelled) setPinsLoading(false) })
    return () => { cancelled = true }
  }, [open])

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
          position: pins.reduce((max, p) => Math.max(max, p.position), -1) + 1,
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
    const res = await fetch(`/api/users/pinned?id=${pinId}`, { method: "DELETE" })
    if (!res.ok) {
      toast({ variant: "destructive", title: "Failed to remove pin" })
      return
    }
    setPins((prev) => prev.filter((p) => p.id !== pinId))
  }

  const pinSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  async function handlePinDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = pins.findIndex((p) => p.id === active.id)
    const newIndex = pins.findIndex((p) => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    // Optimistic update
    const previousPins = pins
    const reordered = arrayMove(pins, oldIndex, newIndex).map((pin, i) => ({ ...pin, position: i }))
    setPins(reordered)

    // Persist each changed position
    try {
      const updates = reordered
        .filter((pin, i) => previousPins[i]?.id !== pin.id)
        .map((pin) =>
          fetch(`/api/users/pinned?id=${pin.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position: pin.position }),
          })
        )
      const results = await Promise.all(updates)
      if (results.some((r) => !r.ok)) throw new Error("Failed to update pin order")
    } catch {
      setPins(previousPins)
      toast({ variant: "destructive", title: "Failed to reorder pins" })
    }
  }

  async function saveActivityVisibility(value: "public" | "friends" | "private") {
    const previousValue = activityVisibility
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
      setActivityVisibility(previousValue)
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Error" })
    } finally {
      setVisibilitySaving(false)
    }
  }

  // Revoke blob URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!showStatusEmojiPicker) return
    function handleClickOutside(e: PointerEvent) {
      if (!statusEmojiPickerRef.current?.contains(e.target as Node)) {
        setShowStatusEmojiPicker(false)
      }
    }
    document.addEventListener("pointerdown", handleClickOutside)
    return () => document.removeEventListener("pointerdown", handleClickOutside)
  }, [showStatusEmojiPicker])

  async function handleSave() {
    setLoading(true)
    try {
      let avatarUrl = user.avatar_url

      // Upload avatar through server-side API endpoint
      if (avatarFile) {
        const formData = new FormData()
        formData.append("avatar", avatarFile)
        const uploadRes = await fetch("/api/users/avatar", { method: "POST", body: formData })
        const uploadPayload = await uploadRes.json().catch(() => ({}))
        if (!uploadRes.ok) throw new Error(uploadPayload?.error || "Avatar upload failed")
        if (!uploadPayload.avatar_url) throw new Error("Avatar upload succeeded but no URL returned")
        avatarUrl = uploadPayload.avatar_url
      }

      // Validate custom expiry duration
      if (statusExpiryDirty && statusExpiryKey === "custom" && customExpiryHours * 60 + customExpiryMinutes <= 0) {
        toast({ variant: "destructive", title: "Invalid expiry", description: "Custom expiry must be at least 1 minute." })
        setLoading(false)
        return
      }

      const updates = {
        display_name: displayName.trim() || null,
        username: username.trim().toLowerCase(),
        bio: bio.trim() || null,
        custom_tag: customTag.trim() || null,
        status_message: statusMessage.trim() || null,
        status_emoji: statusEmoji.trim() || null,
        status_expires_at: statusExpiryDirty
          ? (getStatusExpiryIso(statusExpiryKey, statusExpiryKey === "custom" ? customExpiryHours * 60 + customExpiryMinutes : undefined) || null)
          : user.status_expires_at ?? null,
        status,
        banner_color: bannerColor,
        avatar_url: avatarUrl,
      }

      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const payload = await res.json()

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to save profile")
      }

      setCurrentUser(payload)
      toast({ title: "Profile updated!" })
      onClose()
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "Failed to save profile", description: error instanceof Error ? error.message : "Unknown error" })
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    const supabase = createClientSupabaseClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast({ variant: "destructive", title: "Sign out failed", description: error.message })
      return
    }
    router.push("/login")
    router.refresh()
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported image format",
        description: "Avatars must be JPG, PNG, GIF, or WebP.",
      })
      e.target.value = ""
      return
    }

    if (file.size > MAX_AVATAR_SIZE) {
      toast({
        variant: "destructive",
        title: "Image too large",
        description: "Avatars must be under 5 MB.",
      })
      e.target.value = ""
      return
    }

    setAvatarFile(file)
    if (avatarPreview && avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const displayNamePreview = displayName || user.username
  const tabMeta = {
    profile: {
      title: "My Account",
      subtitle: "Update your profile identity, status, and account details.",
    },
    security: {
      title: "Security",
      subtitle: "Manage login methods, recovery controls, and high-risk account actions.",
    },
    connections: {
      title: "Connections",
      subtitle: "Link Steam and social profiles to show your gaming and creator identity.",
    },
    appearance: {
      title: "Appearance",
      subtitle: "Adjust chat readability and visual comfort settings.",
    },
  } as const

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className={`overflow-hidden p-0 ${isMobile ? 'h-[100dvh] w-screen max-w-none max-h-none rounded-none border-0' : 'max-w-2xl max-h-[90vh]'}`}
        style={{ background: "var(--theme-bg-primary)", borderColor: "var(--theme-bg-tertiary)", paddingTop: isMobile ? "env(safe-area-inset-top)" : undefined }}
        hideClose={isMobile}
      >
        {/* Mobile header with close button */}
        {isMobile && (
          <div
            className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
            style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}
          >
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 active:bg-white/15"
              style={{ color: "var(--theme-text-secondary)" }}
              aria-label="Close settings"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold" style={{ color: "var(--theme-text-primary)" }}>
              User Settings
            </span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "profile" | "security" | "connections" | "appearance")} orientation={isMobile ? "horizontal" : "vertical"} className={`flex ${isMobile ? 'flex-col flex-1 min-h-0' : 'flex-row h-[80vh]'}`}>
          {/* Desktop: vertical sidebar nav */}
          {!isMobile && (
            <div className="w-52 flex-shrink-0 p-4 flex flex-col" style={{ background: "var(--theme-bg-secondary)" }}>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>
                User Settings
              </h3>

              <TabsList className="flex flex-col h-auto bg-transparent gap-0.5 w-full">
                <TabsTrigger value="profile" className="w-full justify-start text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  My Account
                </TabsTrigger>
                <TabsTrigger value="security" className="w-full justify-start text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Security
                </TabsTrigger>
                <TabsTrigger value="connections" className="w-full justify-start text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Connections
                </TabsTrigger>
                <TabsTrigger value="appearance" className="w-full justify-start text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Appearance
                </TabsTrigger>
              </TabsList>
            </div>
          )}

          {/* Mobile: horizontal scrollable tabs */}
          {isMobile && (
            <div className="flex-shrink-0 border-b" style={{ background: "var(--theme-bg-secondary)", borderColor: "var(--theme-bg-tertiary)" }}>
              <TabsList className="flex h-auto bg-transparent gap-1 px-3 py-2 overflow-x-auto w-full justify-start">
                <TabsTrigger value="profile" className="flex-shrink-0 text-sm px-3 py-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Account
                </TabsTrigger>
                <TabsTrigger value="security" className="flex-shrink-0 text-sm px-3 py-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Security
                </TabsTrigger>
                <TabsTrigger value="connections" className="flex-shrink-0 text-sm px-3 py-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Connections
                </TabsTrigger>
                <TabsTrigger value="appearance" className="flex-shrink-0 text-sm px-3 py-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white rounded" style={{ color: "var(--theme-text-secondary)" }}>
                  Appearance
                </TabsTrigger>
              </TabsList>
            </div>
          )}

          {/* Main content */}
          <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-4' : 'p-6'}`}>
                <DialogHeader className="mb-6 space-y-1">
                  <DialogTitle className="text-2xl font-semibold leading-tight text-white">{tabMeta[activeTab].title}</DialogTitle>
                  <DialogDescription className="sr-only">Edit your profile settings</DialogDescription>
                  <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>{tabMeta[activeTab].subtitle}</p>
                </DialogHeader>

                <TabsContent value="profile" className="mt-0 space-y-8">
                  {/* Profile preview card */}
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--theme-bg-tertiary)" }}>
                    {/* Banner */}
                    <div
                      className="h-20 relative"
                      style={{ background: /^#[0-9a-f]{6}$/i.test(bannerColor) ? bannerColor : "var(--theme-accent)" }}
                    />

                    {/* Avatar */}
                    <div className="px-4 pb-4" style={{ background: "var(--theme-bg-secondary)" }}>
                      <div className="relative inline-block -mt-8 mb-3">
                        <div
                          className="cursor-pointer"
                          role="button"
                          tabIndex={0}
                          aria-label="Upload avatar"
                          onClick={() => avatarRef.current?.click()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              avatarRef.current?.click()
                            }
                          }}
                        >
                          <Avatar className="w-20 h-20 ring-4" style={{ "--tw-ring-color": "var(--theme-bg-secondary)" } as React.CSSProperties}>
                            {(avatarPreview ?? user.avatar_url) && <AvatarImage src={(avatarPreview ?? user.avatar_url)!} />}
                            <AvatarFallback
                              style={{ background: "var(--theme-accent)", color: "white", fontSize: "24px" }}
                            >
                              {displayNamePreview.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <Upload className="w-6 h-6 text-white" />
                          </div>
                        </div>
                        <input
                          ref={avatarRef}
                          type="file"
                          accept=".jpg,.jpeg,.png,.gif,.webp"
                          className="hidden"
                          onChange={handleAvatarChange}
                        />
                      </div>
                      <div className="font-bold text-white">{displayNamePreview}</div>
                      <div className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>#{user.username}</div>
                      {user.custom_tag && (
                        <div className="text-xs mt-1" style={{ color: "var(--theme-text-muted)" }}>{user.custom_tag}</div>
                      )}
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="profile-display-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        Display Name
                      </Label>
                      <Input
                        id="profile-display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={user.username}
                        style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-username" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        Username
                      </Label>
                      <Input
                        id="profile-username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-custom-tag" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        Custom Tag / Subtitle
                      </Label>
                      <Input
                        id="profile-custom-tag"
                        value={customTag}
                        onChange={(e) => setCustomTag(e.target.value)}
                        placeholder="e.g. Game Dev | Coffee Addict"
                        style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-bio" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        About Me
                      </Label>
                      <Textarea
                        id="profile-bio"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Tell the world a little about yourself"
                        rows={3}
                        maxLength={190}
                        className="w-full rounded px-3 py-2 text-sm focus:outline-none"
                        style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
                      />
                      <div className="text-right text-xs" style={{ color: "var(--theme-text-faint)" }}>
                        {bio.length}/190
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        Status
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        {STATUS_OPTIONS.map(({ value, label, color }) => (
                          <button
                            key={value}
                            onClick={() => setStatus(value)}
                            className="flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors text-left"
                            style={{
                              background: status === value ? "rgba(255,255,255,0.1)" : "var(--theme-bg-tertiary)",
                              border: `1px solid ${status === value ? "var(--theme-accent)" : "transparent"}`,
                              color: "var(--theme-text-primary)",
                            }}
                          >
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-status-message" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        Custom Status
                      </Label>
                      <div className="grid grid-cols-[90px_1fr] gap-2">
                        <div className="relative" ref={statusEmojiPickerRef}>
                          <button
                            type="button"
                            onClick={() => setShowStatusEmojiPicker((v) => !v)}
                            aria-label="Choose status emoji"
                            aria-haspopup="dialog"
                            aria-expanded={showStatusEmojiPicker}
                            className="w-full h-10 flex items-center justify-center rounded text-xl transition-colors hover:brightness-110"
                            style={{ background: "var(--theme-bg-tertiary)", border: "1px solid var(--theme-bg-tertiary)" }}
                          >
                            {statusEmoji || <span style={{ opacity: 0.4, fontSize: "18px" }}>😀</span>}
                          </button>
                          {showStatusEmojiPicker && EmojiPicker && (
                            <div
                              role="dialog"
                              aria-label="Emoji picker"
                              className="absolute z-50 rounded-lg shadow-xl border overflow-hidden"
                              style={{
                                bottom: "calc(100% + 6px)",
                                left: 0,
                                width: 300,
                                height: 360,
                                background: "var(--theme-bg-secondary)",
                                borderColor: "var(--theme-bg-tertiary)",
                                display: "flex",
                                flexDirection: "column",
                              }}
                            >
                              <EmojiPicker.Root
                                onEmojiSelect={({ emoji }) => {
                                  setStatusEmoji(emoji)
                                  setShowStatusEmojiPicker(false)
                                }}
                                style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
                              >
                                <div style={{ padding: "6px 6px 4px" }}>
                                  <EmojiPicker.Search
                                    autoFocus
                                    style={{
                                      display: "block",
                                      width: "100%",
                                      padding: "5px 10px",
                                      borderRadius: "6px",
                                      fontSize: "13px",
                                      boxSizing: "border-box",
                                      background: "var(--theme-bg-tertiary)",
                                      color: "var(--theme-text-normal)",
                                      border: "none",
                                      outline: "none",
                                    }}
                                    placeholder="Search emoji…"
                                  />
                                </div>
                                <EmojiPicker.Viewport style={{ flex: 1, overflow: "hidden auto" }}>
                                  <EmojiPicker.Loading>
                                    <div style={{ padding: "12px", color: "var(--theme-text-muted)", fontSize: "12px" }}>Loading…</div>
                                  </EmojiPicker.Loading>
                                  <EmojiPicker.Empty>
                                    {({ search }) => (
                                      <div style={{ padding: "12px", color: "var(--theme-text-muted)", fontSize: "12px" }}>
                                        No emoji found for &ldquo;{search}&rdquo;
                                      </div>
                                    )}
                                  </EmojiPicker.Empty>
                                  <EmojiPicker.List
                                    components={{
                                      CategoryHeader: ({ category, ...props }) => (
                                        <div
                                          {...props}
                                          style={{
                                            padding: "3px 8px",
                                            fontSize: "10px",
                                            fontWeight: 600,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.06em",
                                            color: "var(--theme-text-muted)",
                                            background: "var(--theme-bg-secondary)",
                                            position: "sticky",
                                            top: 0,
                                          }}
                                        >
                                          {category.label}
                                        </div>
                                      ),
                                      Emoji: ({ emoji, ...props }) => (
                                        <button
                                          type="button"
                                          {...props}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: "18px",
                                            width: "100%",
                                            aspectRatio: "1",
                                            borderRadius: "4px",
                                            cursor: "pointer",
                                            border: "none",
                                            background: emoji.isActive ? "var(--theme-surface-elevated)" : "transparent",
                                            fontFamily: "var(--frimousse-emoji-font)",
                                          }}
                                        >
                                          {emoji.emoji}
                                        </button>
                                      ),
                                    }}
                                  />
                                </EmojiPicker.Viewport>
                                <div style={{ padding: "4px 8px 6px", display: "flex", alignItems: "center", justifyContent: "flex-end", borderTop: "1px solid var(--theme-bg-tertiary)" }}>
                                  <EmojiPicker.SkinToneSelector
                                    style={{
                                      all: "unset",
                                      cursor: "pointer",
                                      fontSize: "16px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      border: "1px solid var(--theme-bg-tertiary)",
                                      background: "var(--theme-bg-tertiary)",
                                    }}
                                    aria-label="Change skin tone"
                                  />
                                </div>
                              </EmojiPicker.Root>
                            </div>
                          )}
                        </div>
                        <Input
                          id="profile-status-message"
                          value={statusMessage}
                          onChange={(e) => setStatusMessage(e.target.value)}
                          placeholder="What are you up to?"
                          maxLength={128}
                          style={{ background: "var(--theme-bg-tertiary)", borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)" }}
                        />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={statusExpiryKey}
                          onChange={(e) => { setStatusExpiryKey(e.target.value as StatusExpiryKey); setStatusExpiryDirty(true) }}
                          className="text-xs rounded px-2 py-1"
                          style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
                        >
                          {STATUS_EXPIRY_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                        {statusExpiryKey === "custom" && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={23}
                              value={customExpiryHours}
                              onChange={(e) => { setCustomExpiryHours(Math.max(0, Math.min(23, Number(e.target.value) || 0))); setStatusExpiryDirty(true) }}
                              className="w-12 text-xs rounded px-1.5 py-1 text-center"
                              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
                              aria-label="Hours"
                            />
                            <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>h</span>
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={customExpiryMinutes}
                              onChange={(e) => { setCustomExpiryMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0))); setStatusExpiryDirty(true) }}
                              className="w-12 text-xs rounded px-1.5 py-1 text-center"
                              style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
                              aria-label="Minutes"
                            />
                            <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>m</span>
                          </div>
                        )}
                        {statusExpiryKey !== "never" && (
                          <button
                            type="button"
                            onClick={() => { setStatusExpiryKey("never"); setStatusExpiryDirty(true) }}
                            className="text-xs px-2 py-1 rounded hover:bg-white/10"
                            style={{ color: "var(--theme-text-muted)" }}
                          >
                            Clear expiry
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-secondary)" }}>
                        Banner Color
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {BANNER_PRESETS.map((color) => (
                          <button
                            key={color}
                            onClick={() => setBannerColor(color)}
                            className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                            style={{
                              background: color,
                              outline: bannerColor === color ? "2px solid white" : "none",
                              outlineOffset: "2px",
                            }}
                          />
                        ))}
                        {/* Custom color: show swatch of chosen color when custom, rainbow wheel otherwise */}
                        <label
                          className="w-8 h-8 rounded-full cursor-pointer transition-transform hover:scale-110 relative flex items-center justify-center overflow-hidden"
                          style={{
                            outline: !BANNER_PRESETS.includes(bannerColor) ? "2px solid white" : "none",
                            outlineOffset: "2px",
                          }}
                          title="Custom color"
                        >
                          {/* Rainbow background always visible as a ring */}
                          <span
                            className="absolute inset-0 rounded-full"
                            style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
                          />
                          {/* If custom color is active, show it as inner circle */}
                          {!BANNER_PRESETS.includes(bannerColor) && (
                            <span
                              className="absolute rounded-full"
                              style={{ inset: "3px", background: bannerColor }}
                            />
                          )}
                          <input
                            type="color"
                            value={bannerColor}
                            onChange={(e) => setBannerColor(e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* ── Interests / Tags ── */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                        Interests
                      </h4>
                      <button
                        type="button"
                        onClick={saveInterests}
                        disabled={interestSaving}
                        className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all hover:brightness-110 disabled:opacity-60"
                        style={{ background: "var(--theme-accent)", color: "white" }}
                      >
                        {interestSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                        Save
                      </button>
                    </div>
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                      Add up to {MAX_TAGS} tags — e.g.{" "}
                      <span style={{ color: "var(--theme-text-secondary)" }}>gaming, ai, self-hosting</span>
                    </p>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} aria-hidden />
                        <input
                          type="text"
                          value={interestInput}
                          onChange={(e) => setInterestInput(e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, ""))}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addInterestTag() } }}
                          maxLength={30}
                          placeholder="minecraft"
                          disabled={interests.length >= MAX_TAGS}
                          className="w-full pl-8 pr-3 py-2 rounded-md text-sm focus:outline-none focus:ring-2"
                          style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }}
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
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </div>
                    {interests.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Your interests">
                        {interests.map((tag) => (
                          <span key={tag} role="listitem" className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium" style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-text-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
                            <Hash className="w-2.5 h-2.5" aria-hidden />{tag}
                            <button type="button" onClick={() => setInterests((prev) => prev.filter((t) => t !== tag))} className="ml-0.5 rounded-full p-0.5 hover:bg-red-500/20 hover:text-red-400 transition-colors" aria-label={`Remove ${tag}`}>
                              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>No interests added yet.</p>
                    )}
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>{interests.length}/{MAX_TAGS}</p>
                  </div>

                  {/* ── Pinned Items ── */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                      Pinned Items
                    </h4>
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                      Pin up to {MAX_PINS} items to your profile.
                    </p>
                    {pinsLoading ? (
                      <div className="space-y-2">
                        {[1, 2].map((n) => (
                          <div key={n} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--theme-bg-secondary)" }} />
                        ))}
                      </div>
                    ) : pins.length > 0 ? (
                      <DndContext sensors={pinSensors} collisionDetection={closestCenter} onDragEnd={handlePinDragEnd}>
                        <SortableContext items={pins.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                          <div className="space-y-1.5" role="list" aria-label="Pinned items">
                            {pins.map((pin) => (
                              <SortablePinItem key={pin.id} pin={pin} onRemove={removePin} />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    ) : (
                      <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>Nothing pinned yet.</p>
                    )}
                    {pins.length < MAX_PINS && (
                      <div className="rounded-lg p-3 space-y-2.5" style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)" }}>
                        <p className="text-xs font-semibold" style={{ color: "var(--theme-text-secondary)" }}>Add a pin</p>
                        <div className="grid grid-cols-2 gap-2">
                          {(["link", "message", "channel", "file"] as const).map((type) => (
                            <button key={type} type="button" onClick={() => setNewPin((prev) => ({ ...prev, pin_type: type }))} className="py-1.5 rounded text-xs font-medium capitalize transition-all" style={{ background: newPin.pin_type === type ? "color-mix(in srgb, var(--theme-accent) 15%, var(--theme-bg-tertiary))" : "var(--theme-bg-tertiary)", border: `1px solid ${newPin.pin_type === type ? "var(--theme-accent)" : "transparent"}`, color: newPin.pin_type === type ? "var(--theme-accent)" : "var(--theme-text-muted)" }}>
                              {type}
                            </button>
                          ))}
                        </div>
                        <input type="text" value={newPin.label} onChange={(e) => setNewPin((prev) => ({ ...prev, label: e.target.value }))} maxLength={120} placeholder="Label (required)" className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus:ring-2" style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }} />
                        <input type="text" value={newPin.sublabel} onChange={(e) => setNewPin((prev) => ({ ...prev, sublabel: e.target.value }))} maxLength={80} placeholder="Sublabel (optional)" className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus:ring-2" style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }} />
                        <input type="url" value={newPin.url} onChange={(e) => setNewPin((prev) => ({ ...prev, url: e.target.value }))} maxLength={2000} placeholder="URL (optional)" className="w-full px-3 py-2 rounded-md text-xs focus:outline-none focus:ring-2" style={{ background: "var(--theme-surface-input)", color: "var(--theme-text-primary)", border: "1px solid var(--theme-bg-tertiary)" }} />
                        <button type="button" onClick={addPin} disabled={pinSaving || pinsLoading || !newPin.label.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all hover:brightness-110 disabled:opacity-60" style={{ background: "var(--theme-accent)", color: "white" }}>
                          {pinSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                          <Plus className="w-3 h-3" /> Add pin
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── Activity Privacy ── */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-text-muted)" }}>
                      Activity Privacy
                    </h4>
                    <p className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                      Control who can see your recent activity feed.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: "public" as const, label: "Public", icon: <Globe className="w-4 h-4" />, description: "Anyone" },
                        { value: "friends" as const, label: "Friends", icon: <Users className="w-4 h-4" />, description: "Friends only" },
                        { value: "private" as const, label: "Private", icon: <Lock className="w-4 h-4" />, description: "Only you" },
                      ]).map(({ value, label, icon, description }) => (
                        <button key={value} type="button" onClick={() => saveActivityVisibility(value)} disabled={visibilitySaving} className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-all disabled:opacity-60" style={{ background: activityVisibility === value ? "color-mix(in srgb, var(--theme-accent) 15%, var(--theme-bg-secondary))" : "var(--theme-bg-secondary)", border: `1px solid ${activityVisibility === value ? "var(--theme-accent)" : "var(--theme-bg-tertiary)"}`, color: activityVisibility === value ? "var(--theme-accent)" : "var(--theme-text-muted)" }} aria-pressed={activityVisibility === value}>
                          {icon}
                          <span>{label}</span>
                          <span className="font-normal opacity-70">{description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

      <div className="rounded-lg p-4 space-y-3" style={{ background: "rgba(242,63,67,0.08)", border: "1px solid rgba(242,63,67,0.35)" }}>
                    <div>
                      <h4 className="text-sm font-semibold" style={{ color: "color-mix(in srgb, var(--theme-danger) 70%, white)" }}>Danger Zone</h4>
                      <p className="text-xs mt-1" style={{ color: "var(--theme-text-muted)" }}>Signing out will end your current session on this device.</p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={handleLogout}
                      className="w-fit"
                      style={{ color: "var(--theme-danger)", background: "rgba(242,63,67,0.12)" }}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Log Out
                    </Button>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
                    <Button
                      onClick={handleSave}
                      disabled={loading}
                      style={{ background: "var(--theme-accent)" }}
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Changes
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="security" className="mt-0 space-y-8">
                  <PasskeysSection />
                  <SecurityPolicySection />
                  <PasswordChangeSection />
                  <RecoveryCodesSection />
                  <SessionManagementSection onForcedLogout={handleLogout} />
                  <TwoFactorSection />
                </TabsContent>

                <TabsContent value="connections" className="mt-0 space-y-8">
                  <ConnectionsSection />
                </TabsContent>

                <TabsContent value="appearance" className="mt-0">
                  <AppearanceTab />
                </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
