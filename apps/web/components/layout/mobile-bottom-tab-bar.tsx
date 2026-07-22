"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid, MessagesSquare, Bell, UserRound } from "lucide-react"
import { cn } from "@/lib/utils/cn"
import { useAppStore } from "@/lib/stores/app-store"
import { isFullScreenChannel } from "@/lib/utils/navigation"

const TABS = [
  { href: "/channels/servers", label: "Servers", icon: LayoutGrid },
  { href: "/channels/me", label: "Messages", icon: MessagesSquare },
  { href: "/channels/notifications", label: "Notifications", icon: Bell },
  { href: "/channels/you", label: "You", icon: UserRound },
]

function isTabActive(href: string, pathname: string): boolean {
  if (href === "/channels/servers") return pathname.startsWith("/channels/servers")
  if (href === "/channels/me") {
    return pathname.startsWith("/channels/me") || pathname.startsWith("/channels/friends")
  }
  if (href === "/channels/notifications") return pathname.startsWith("/channels/notifications")
  if (href === "/channels/you") {
    return pathname.startsWith("/channels/you") || pathname.startsWith("/channels/profile")
  }
  return pathname === href
}

export function MobileBottomTabBar() {
  const pathname = usePathname()
  const notificationUnreadCount = useAppStore((s) => s.notificationUnreadCount)
  const dmUnreadCount = useAppStore((s) => s.dmUnreadCount)
  const serverHasUnread = useAppStore((s) => s.serverHasUnread)
  const serverUnreadCount = Object.values(serverHasUnread).filter(Boolean).length

  // Hide the bottom nav when viewing a channel (full-screen message view)
  if (isFullScreenChannel(pathname)) return null

  return (
    <nav
      className="md:hidden fixed z-tabbar left-3 right-3"
      style={{
        bottom: "calc(var(--mobile-tabbar-gap) + env(safe-area-inset-bottom))",
      }}
      aria-label="Mobile sections"
    >
      <ul
        className="flex items-center justify-around rounded-2xl px-1"
        style={{
          height: "var(--mobile-tabbar-height)",
          background: "color-mix(in srgb, var(--theme-bg-secondary) 82%, transparent)",
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          boxShadow: "0 4px 24px color-mix(in srgb, var(--theme-bg-tertiary) 70%, transparent), inset 0 0.5px 0 color-mix(in srgb, var(--theme-text-primary) 6%, transparent)",
          border: "1px solid color-mix(in srgb, var(--theme-text-primary) 8%, transparent)",
        }}
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isTabActive(href, pathname)
          const showNotifBadge = href === "/channels/notifications" && notificationUnreadCount > 0
          const showDmBadge = href === "/channels/me" && dmUnreadCount > 0
          const showServerBadge = href === "/channels/servers" && serverUnreadCount > 0
          const badgeCount = showNotifBadge ? notificationUnreadCount : showDmBadge ? dmUnreadCount : showServerBadge ? serverUnreadCount : 0
          return (
            <li key={label} className="flex-1 flex justify-center">
              <Link
                href={href}
                onClick={() => { if (!active) navigator.vibrate?.(10) }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center justify-center gap-1.5 rounded-xl px-3 h-[44px] transition-all",
                  "motion-safe:duration-200 motion-safe:ease-out",
                  active ? "min-w-[72px]" : "w-12",
                )}
                style={{
                  background: active
                    ? "color-mix(in srgb, var(--theme-accent) 16%, transparent)"
                    : "transparent",
                  color: active ? "var(--theme-accent)" : "var(--theme-text-secondary)",
                }}
              >
                <span className="relative overflow-visible flex-shrink-0">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                  {badgeCount > 0 && (
                    <span
                      className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[10px] font-bold px-0.5"
                      style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </span>
                {active && (
                  <span className="text-xs font-semibold whitespace-nowrap motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-1 motion-safe:duration-200">
                    {label}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
