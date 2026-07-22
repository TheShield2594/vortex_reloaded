"use client"

import { useMemo, type CSSProperties } from "react"
import { Calendar, ExternalLink, MessageSquare, Shield, UserMinus, UserPlus, X } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { sanitizeBannerColor } from "@/lib/banner-color"
import { useFriendshipActions } from "@/hooks/use-friendship-actions"
import { getStatusLabel } from "@/lib/presence-status"
import type { RoleRow } from "@/types/database"
import { PERMISSIONS } from "@vortex/shared"
import { ProfileInterestTags } from "@/components/profile/profile-interest-tags"
import { ProfilePinnedItems } from "@/components/profile/profile-pinned-items"
import { ProfileActivity } from "@/components/profile/profile-activity"
import { ProfileConnections } from "@/components/profile/profile-connections"
import { ProfileBadges } from "@/components/profile/profile-badges"
import { ThemeIdentityBadge } from "@/components/settings/theme-identity-section"
import { useAppearanceStore } from "@/lib/stores/appearance-store"

interface ProfileUser {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  banner_color: string | null
  status_message: string | null
  status_emoji?: string | null
  status_expires_at?: string | null
  created_at?: string
  interests?: string[]
}

interface ProfilePanelProps {
  user: ProfileUser | null
  displayName: string
  status?: string
  roles?: RoleRow[]
  currentUserId?: string
  onClose: () => void
}


function getJoinedDate(rawDate?: string) {
  if (!rawDate) return "Unknown"
  const date = new Date(rawDate)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

/** Shimmer skeleton for the profile panel while user data is loading. */
export function ProfilePanelSkeleton({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div
      className="w-80 shrink-0 flex flex-col overflow-hidden"
      style={{ background: "var(--theme-bg-secondary)", borderRight: "1px solid var(--theme-bg-tertiary)" }}
    >
      {/* Banner shimmer */}
      <div
        className="h-24 relative animate-pulse"
        style={{ background: "color-mix(in srgb, var(--theme-accent) 20%, var(--theme-bg-secondary))" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 p-1.5 rounded-full transition-colors"
          style={{ background: "color-mix(in srgb, var(--theme-bg-primary) 70%, transparent)", color: "var(--theme-text-normal)" }}
          aria-label="Close profile"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Avatar placeholder */}
      <div className="px-4 -mt-10 relative">
        <div
          className="w-20 h-20 rounded-full ring-4 animate-pulse"
          style={{ background: "var(--theme-bg-tertiary)", "--tw-ring-color": "var(--theme-bg-secondary)" } as CSSProperties}
        />
      </div>

      {/* Text line stubs */}
      <div className="px-4 pt-3 pb-4 space-y-3">
        <div className="space-y-2">
          <div className="h-5 w-36 rounded animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
          <div className="h-3.5 w-24 rounded animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
        </div>
        <div className="h-16 rounded-xl animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
        <div className="h-12 rounded-xl animate-pulse" style={{ background: "var(--theme-bg-tertiary)" }} />
      </div>
    </div>
  )
}

/** Reads the current user's theme from the appearance store and renders a badge. */
function CurrentUserThemeBadge(): React.ReactElement {
  const themePreset = useAppearanceStore((s) => s.themePreset)
  return (
    <section className="px-1">
      <ThemeIdentityBadge themeName={themePreset} />
    </section>
  )
}

/** Expanded member profile panel shown from the member list. */
export function ProfilePanel({ user, displayName, status, roles = [], currentUserId, onClose }: ProfilePanelProps) {
  const {
    friendshipStatus,
    actionLoading,
    isOtherUser,
    handleMessage,
    handleAddFriend,
    handleRemoveFriend,
  } = useFriendshipActions({
    userId: user?.id,
    username: user?.username,
    currentUserId,
    fetchOnMount: true,
  })

  const initials = displayName.slice(0, 2).toUpperCase()
  const joined = useMemo(() => getJoinedDate(user?.created_at), [user?.created_at])
  const statusExpired = Boolean(user?.status_expires_at && new Date(user.status_expires_at).getTime() <= Date.now())
  const customStatus = !statusExpired ? [user?.status_emoji, user?.status_message].filter(Boolean).join(" ").trim() : ""
  const bannerColor = sanitizeBannerColor(user?.banner_color)
  const isAdmin = roles.some((role) => Boolean(role.permissions & PERMISSIONS.ADMINISTRATOR))

  return (
    <div
      className="w-80 shrink-0 flex flex-col overflow-hidden"
      style={{ background: "var(--theme-bg-secondary)", borderRight: "1px solid var(--theme-bg-tertiary)" }}
    >
      <div
        className="h-24 relative"
        style={{
          background: bannerColor || "color-mix(in srgb, var(--theme-accent) 20%, var(--theme-bg-secondary))",
          ...(bannerColor ? { "--profile-banner-color": bannerColor } as CSSProperties : {}),
        }}
      >
        {bannerColor && <div className="absolute inset-0 bg-[var(--profile-banner-color)]" />}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 p-1.5 rounded-full transition-colors"
          style={{ background: "color-mix(in srgb, var(--theme-bg-primary) 70%, transparent)", color: "var(--theme-text-normal)" }}
          aria-label="Close profile"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 -mt-10 relative">
        <Avatar className="w-20 h-20 ring-4" style={{ "--tw-ring-color": "var(--theme-bg-secondary)" } as CSSProperties}>
          {user?.avatar_url && <AvatarImage src={user.avatar_url} />}
          <AvatarFallback className="text-2xl font-semibold" style={{ background: "var(--theme-accent)", color: "white" }}>
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 pt-2 pb-4 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold truncate" style={{ color: "var(--theme-text-normal)" }}>{displayName}</h3>
              {isAdmin && (
                <Shield className="w-4 h-4" style={{ color: "var(--theme-accent)" }} />
              )}
            </div>
            {user?.username && <p className="text-sm" style={{ color: "var(--theme-text-muted)" }}>@{user.username}</p>}
          </div>

          {isOtherUser && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleMessage}
                disabled={actionLoading === "message"}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--theme-accent)", color: "white" }}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Message
              </button>
              {friendshipStatus === "friends" ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      disabled={actionLoading === "friend"}
                      className="px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                      style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
                      aria-label="Remove friend"
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove Friend</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to remove {user?.display_name || user?.username || displayName} from your friends?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRemoveFriend}
                        className="hover:opacity-90"
                        style={{ background: "var(--theme-danger)", color: "var(--theme-danger-foreground)" }}
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={actionLoading === "friend" || friendshipStatus === "pending_sent"}
                  className="px-3 py-2 rounded-lg disabled:opacity-50 hover:brightness-125 transition-all"
                  style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-normal)" }}
                  aria-label={friendshipStatus === "pending_sent" ? "Friend request sent" : "Add friend"}
                  title={friendshipStatus === "pending_sent" ? "Friend request sent" : "Add friend"}
                >
                  <UserPlus className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {((status != null && status !== "offline") || customStatus) && (
            <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
              <h4 className="text-[11px] font-semibold tracking-wider mb-1.5" style={{ color: "var(--theme-text-muted)" }}>STATUS</h4>
              {status != null && <p className="text-sm" style={{ color: "var(--theme-text-normal)" }}>{getStatusLabel(status)}</p>}
              {customStatus && <p className="text-sm mt-1" style={{ color: "var(--theme-text-muted)" }}>{customStatus}</p>}
            </section>
          )}

          {user?.bio && (
            <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
              <h4 className="text-[11px] font-semibold tracking-wider mb-1.5" style={{ color: "var(--theme-text-muted)" }}>ABOUT ME</h4>
              <p className="text-sm leading-relaxed" style={{ color: "var(--theme-text-normal)" }}>{user.bio}</p>
            </section>
          )}

          <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
            <h4 className="text-[11px] font-semibold tracking-wider mb-1.5" style={{ color: "var(--theme-text-muted)" }}>MEMBER SINCE</h4>
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-text-normal)" }}>
              <Calendar className="w-3.5 h-3.5" style={{ color: "var(--theme-text-muted)" }} />
              {joined}
            </div>
          </section>

          {roles.length > 0 && (
            <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
              <h4 className="text-[11px] font-semibold tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>ROLES</h4>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((role) => (
                  <span
                    key={role.id}
                    className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-full"
                    style={{ background: `color-mix(in srgb, ${role.color || "var(--theme-accent)"} 15%, var(--theme-bg-tertiary))`, color: "var(--theme-text-normal)" }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: role.color || "var(--theme-accent)" }} />
                    {role.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Badges */}
          {user?.id && (
            <ProfileBadges userId={user.id} />
          )}

          {/* Connections */}
          {user?.id && (
            <ProfileConnections userId={user.id} />
          )}

          {/* Theme Identity — shows which theme the current user uses */}
          {user?.id && user.id === currentUserId && (
            <CurrentUserThemeBadge />
          )}

          {/* Interests / Tags */}
          {(user?.interests && user.interests.length > 0) && (
            <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
              <h4 className="text-[11px] font-semibold tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>INTERESTS</h4>
              <ProfileInterestTags tags={user.interests} />
            </section>
          )}

          {/* Pinned Items */}
          {user?.id && (
            <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
              <h4 className="text-[11px] font-semibold tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>PINNED</h4>
              <ProfilePinnedItems userId={user.id} />
            </section>
          )}

          {/* Recent Activity */}
          {user?.id && (
            <section className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}>
              <h4 className="text-[11px] font-semibold tracking-wider mb-2" style={{ color: "var(--theme-text-muted)" }}>RECENT ACTIVITY</h4>
              <ProfileActivity userId={user.id} />
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
