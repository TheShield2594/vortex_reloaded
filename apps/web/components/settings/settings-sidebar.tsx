"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  User,
  Palette,
  Shield,
  Bell,
  LogOut,
  ArrowLeft,
  Keyboard,
  Volume2,
  Accessibility,
} from "lucide-react"
import type { UserRow } from "@/types/database"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useState, useMemo } from "react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useToast } from "@/components/ui/use-toast"

interface Props {
  user: UserRow
}

const NAV_SECTIONS = [
  {
    label: "User Settings",
    items: [
      { href: "/settings/profile", label: "My Profile", icon: User },
      { href: "/settings/appearance", label: "Appearance", icon: Palette },
      { href: "/settings/accessibility", label: "Accessibility", icon: Accessibility },
      { href: "/settings/notifications", label: "Notifications", icon: Bell },
      { href: "/settings/voice", label: "Voice & Video", icon: Volume2 },
      { href: "/settings/security", label: "Security & Privacy", icon: Shield },
      { href: "/settings/keybinds", label: "Keybinds", icon: Keyboard, hideOnMobile: true },
    ],
  },
]

export function SettingsSidebar({ user }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { toast } = useToast()
  const [supabase] = useState(() => createClientSupabaseClient())
  const initials = useMemo(() => {
    const name = user.display_name || user.username || "?"
    return name.slice(0, 2).toUpperCase()
  }, [user])

  async function handleLogout() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast({ variant: "destructive", title: "Sign out failed", description: error.message })
      return
    }
    router.replace("/login")
  }

  return (
    <aside
      className="w-full md:w-56 flex-shrink-0 flex flex-col h-full md:border-r overflow-y-auto"
      style={{
        background: "var(--theme-bg-secondary)",
        borderColor: "var(--theme-bg-tertiary)",
      }}
    >
      {/* Back to app */}
      <div className="px-3 pt-4 pb-2">
        <Link
          href="/channels/me"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/10 focus-ring"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to app
        </Link>
      </div>

      {/* User profile mini card */}
      <div
        className="mx-3 mb-2 p-2.5 rounded-lg flex items-center gap-2.5"
        style={{ background: "var(--theme-bg-tertiary)" }}
      >
        <Avatar className="w-8 h-8 flex-shrink-0">
          {user.avatar_url && <AvatarImage src={user.avatar_url} alt={user.display_name ?? user.username ?? "User avatar"} />}
          <AvatarFallback
            className="text-xs font-bold"
            style={{ background: user.banner_color ?? "var(--theme-accent)", color: "white" }}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--theme-text-primary)" }}>
            {user.display_name ?? user.username}
          </p>
          {user.custom_tag && (
            <p className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>
              #{user.custom_tag}
            </p>
          )}
        </div>
      </div>

      <div className="px-2 flex-1">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <p
              className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--theme-text-muted)" }}
            >
              {section.label}
            </p>
            {section.items.map(({ href, label, icon: Icon, hideOnMobile }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${hideOnMobile ? "hidden md:flex" : "flex"} items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors mb-0.5 focus-ring`}
                  style={{
                    background: active ? "color-mix(in srgb, var(--theme-accent) 15%, transparent)" : "transparent",
                    color: active ? "var(--theme-text-bright)" : "var(--theme-text-secondary)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Logout */}
      <div className="px-3 pb-4">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-white/10 focus-ring"
          style={{ color: "var(--theme-danger)" }}
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>
    </aside>
  )
}
