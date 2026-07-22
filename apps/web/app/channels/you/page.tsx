"use client"

import { useState, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { User, Palette, Bell, Shield, Volume2, LogOut, Circle } from "lucide-react"
import { useAppStore } from "@/lib/stores/app-store"
import { useShallow } from "zustand/react/shallow"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import type { UserRow } from "@/types/database"
import { STATUS_OPTIONS } from "@/lib/utils/status-options"

const SETTINGS_LINKS = [
  { href: "/settings/profile", label: "My Profile", icon: User },
  { href: "/settings/appearance", label: "Appearance", icon: Palette },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/voice", label: "Voice & Video", icon: Volume2 },
  { href: "/settings/security", label: "Security & Privacy", icon: Shield },
]

export default function YouPage() {
  const { currentUser, setCurrentUser } = useAppStore(
    useShallow((s) => ({ currentUser: s.currentUser, setCurrentUser: s.setCurrentUser }))
  )
  const router = useRouter()
  const { toast } = useToast()
  const supabase = useMemo(() => createClientSupabaseClient(), [])
  const statusAbortRef = useRef<AbortController | null>(null)

  if (!currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "var(--theme-bg-primary)" }}>
        <p style={{ color: "var(--theme-text-muted)" }}>Loading...</p>
      </div>
    )
  }

  const displayName = currentUser.display_name || currentUser.username
  const initials = displayName.slice(0, 2).toUpperCase()

  async function handleSetStatus(status: UserRow["status"]): Promise<void> {
    const latestUser = useAppStore.getState().currentUser
    if (!latestUser) return

    // Abort any in-flight status request so stale responses can't overwrite
    statusAbortRef.current?.abort()
    const controller = new AbortController()
    statusAbortRef.current = controller

    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Failed to update status")
      }
      const updatedUser = await res.json()
      setCurrentUser(updatedUser)
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return
      toast({ variant: "destructive", title: "Failed to update status", description: error instanceof Error ? error.message : "Unknown error" })
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        toast({ variant: "destructive", title: "Sign out failed", description: error.message })
        return
      }
      router.push("/login")
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Sign out failed", description: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "var(--theme-bg-primary)" }}>
      {/* Profile card */}
      <div className="px-4 pt-6 pb-4">
        <div
          className="rounded-xl p-4 flex flex-col items-center"
          style={{ background: "var(--theme-bg-secondary)" }}
        >
          <button
            type="button"
            onClick={() => router.push("/settings/profile")}
            aria-label="Open profile settings"
            className="relative group"
          >
            <Avatar className="w-20 h-20">
              {currentUser.avatar_url && <AvatarImage src={currentUser.avatar_url} />}
              <AvatarFallback
                className="text-xl font-bold"
                style={{ background: currentUser.banner_color ?? "var(--theme-accent)", color: "white" }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <span
              className="absolute bottom-0 right-0 w-5 h-5 rounded-full border-3"
              style={{
                background: STATUS_OPTIONS.find((o) => o.value === currentUser.status)?.color ?? "var(--theme-presence-offline)",
                borderColor: "var(--theme-bg-secondary)",
              }}
            />
            <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <span className="text-white text-xs font-semibold">Edit</span>
            </span>
          </button>
          <h2 className="mt-3 text-lg font-bold text-white">{displayName}</h2>
          <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>@{currentUser.username}</p>
          {currentUser.bio && (
            <p className="mt-2 text-sm text-center max-w-xs" style={{ color: "var(--theme-text-secondary)" }}>
              {currentUser.bio}
            </p>
          )}
        </div>
      </div>

      {/* Status selector */}
      <div className="px-4 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2 px-1" style={{ color: "var(--theme-text-muted)" }}>
          Status
        </p>
        <div className="grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map(({ value, label, color }) => (
            <button
              type="button"
              key={value}
              onClick={() => handleSetStatus(value)}
              aria-pressed={currentUser.status === value}
              aria-label={`Set status to ${label}`}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors"
              style={{
                background: currentUser.status === value
                  ? "color-mix(in srgb, var(--theme-accent) 15%, transparent)"
                  : "var(--theme-bg-secondary)",
                border: currentUser.status === value ? "1px solid var(--theme-accent)" : "1px solid transparent",
              }}
            >
              <Circle className="w-3 h-3 fill-current" style={{ color }} />
              <span className="text-sm" style={{ color: "var(--theme-text-primary)" }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Settings links */}
      <div className="px-4 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2 px-1" style={{ color: "var(--theme-text-muted)" }}>
          Settings
        </p>
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--theme-bg-secondary)" }}>
          {SETTINGS_LINKS.map(({ href, label, icon: Icon }, i) => (
            <button
              type="button"
              key={href}
              onClick={() => router.push(href)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
              style={{
                borderBottom: i < SETTINGS_LINKS.length - 1 ? "1px solid var(--theme-bg-tertiary)" : undefined,
              }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
              <span className="text-sm" style={{ color: "var(--theme-text-primary)" }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Logout */}
      <div className="px-4 pb-8">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-colors hover:bg-red-500/10"
          style={{ background: "var(--theme-bg-secondary)", color: "var(--theme-danger)" }}
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-semibold">Log Out</span>
        </button>
      </div>

    </div>
  )
}
