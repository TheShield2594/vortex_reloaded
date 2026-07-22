"use client"

import { useEffect, useState } from "react"
import {
  Award, Bug, Crown, Shield, MessageCircle, Headphones,
  Flame, Calendar, Star, CheckCircle, Rocket,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface BadgeDefinition {
  id: string
  name: string
  description: string
  icon: string
  color: string
  category: string
  rarity: string
}

interface UserBadge {
  id: string
  badge_id: string
  awarded_at: string
  badge: BadgeDefinition
}

const ICON_MAP: Record<string, React.ElementType> = {
  rocket: Rocket,
  bug: Bug,
  crown: Crown,
  shield: Shield,
  "message-circle": MessageCircle,
  headphones: Headphones,
  flame: Flame,
  calendar: Calendar,
  star: Star,
  "check-circle": CheckCircle,
  award: Award,
}

const RARITY_GLOW: Record<string, string> = {
  common: "",
  uncommon: "drop-shadow(0 0 3px var(--badge-color))",
  rare: "drop-shadow(0 0 6px var(--badge-color))",
  legendary: "drop-shadow(0 0 10px var(--badge-color)) drop-shadow(0 0 20px var(--badge-color))",
}

interface ProfileBadgesProps {
  userId: string
}

export function ProfileBadges({ userId }: ProfileBadgesProps) {
  const [badges, setBadges] = useState<UserBadge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchBadges() {
      try {
        const res = await fetch(`/api/users/badges?userId=${encodeURIComponent(userId)}`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setBadges(data)
        }
      } catch {
        // Non-critical — badges simply won't show
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchBadges()
    return () => { cancelled = true }
  }, [userId])

  if (loading || badges.length === 0) return null

  return (
    <section
      className="rounded-xl p-3"
      style={{ background: "color-mix(in srgb, var(--theme-bg-tertiary) 60%, transparent)" }}
    >
      <h4
        className="text-[11px] font-semibold tracking-wider mb-2"
        style={{ color: "var(--theme-text-muted)" }}
      >
        BADGES
      </h4>
      <div className="flex flex-wrap gap-2">
        {badges.map(({ id, badge }) => {
          const Icon = ICON_MAP[badge.icon] ?? Award
          const glow = RARITY_GLOW[badge.rarity] ?? ""
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${badge.name}: ${badge.description}`}
                  className="w-8 h-8 rounded-lg flex items-center justify-center cursor-default transition-transform hover:scale-110"
                  style={{
                    background: `color-mix(in srgb, ${badge.color} 20%, var(--theme-bg-tertiary))`,
                    "--badge-color": badge.color,
                    filter: glow,
                  } as React.CSSProperties}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" style={{ color: badge.color }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-52 text-center">
                <p className="font-semibold text-xs">{badge.name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--theme-text-muted)" }}>
                  {badge.description}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </section>
  )
}
