"use client"

import { useRef, useEffect } from "react"
import { Bot } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import type { MemberForMention, PersonaForMention } from "@/lib/stores/app-store"
import type { MentionSuggestion } from "@/hooks/use-mention-autocomplete"

interface Props {
  suggestions: MentionSuggestion[]
  selectedIndex: number
  query: string
  onSelect: (suggestion: MentionSuggestion) => void
}

function getMatchConfidence(name: string, query: string): "Exact" | "Strong" | "Weak" {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return "Strong"
  const lower = name.toLowerCase()
  if (lower === normalized) return "Exact"
  if (lower.startsWith(normalized)) return "Strong"
  return "Weak"
}

function getMemberMatchConfidence(member: MemberForMention, query: string): "Exact" | "Strong" | "Weak" {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return "Strong"

  const options = [member.nickname, member.display_name, member.username]
    .filter(Boolean)
    .map((value) => value!.toLowerCase())

  if (options.some((value) => value === normalized)) return "Exact"
  if (options.some((value) => value.startsWith(normalized))) return "Strong"
  return "Weak"
}

function getPersonaMatchConfidence(persona: PersonaForMention, query: string): "Exact" | "Strong" | "Weak" {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return "Strong"
  const lower = persona.name.toLowerCase()
  if (lower === normalized) return "Exact"
  if (lower.startsWith(normalized)) return "Strong"
  return "Weak"
}

export function MentionSuggestions({ suggestions, selectedIndex, query, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  if (suggestions.length === 0) return null

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Mention suggestions"
      className="rounded-lg shadow-xl overflow-y-auto max-h-52 py-1"
      style={{
        background: "var(--theme-bg-secondary)",
        border: "1px solid var(--theme-bg-tertiary)",
      }}
    >
      {suggestions.map((suggestion, i) => {
        const isSelected = i === selectedIndex

        if (suggestion.type === "role") {
          const role = suggestion.data
          const roleColor = role.color && role.color !== "#000000" ? role.color : null
          const roleTextColor = roleColor ?? "var(--theme-accent)"
          const roleBgColor = roleColor ? `${roleColor}33` : "rgba(88,101,242,0.2)"
          const confidence = getMatchConfidence(role.name, query)
          const confidenceColor = confidence === "Exact" ? "#3ba55d" : confidence === "Strong" ? "#5865f2" : "#faa81a"

          return (
            <button
              key={`role-${role.id}`}
              role="option"
              aria-selected={isSelected}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors"
              style={{
                background: isSelected ? "rgba(88,101,242,0.2)" : "transparent",
                color: "var(--theme-text-normal)",
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(suggestion)
              }}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ background: roleBgColor, color: roleTextColor }}
              >
                @
              </span>
              <span className="text-sm font-medium truncate" style={{ color: roleTextColor }}>
                {role.name}
              </span>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--theme-text-muted)" }}>
                role
              </span>
              <span
                className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ color: confidenceColor, background: `${confidenceColor}26` }}
              >
                {confidence}
              </span>
            </button>
          )
        }

        if (suggestion.type === "persona") {
          const persona = suggestion.data
          const confidence = getPersonaMatchConfidence(persona, query)
          const confidenceTone =
            confidence === "Exact" ? "#3ba55d" : confidence === "Strong" ? "#5865f2" : "#faa81a"
          const initials = persona.name.slice(0, 2).toUpperCase()

          return (
            <button
              key={`persona-${persona.id}`}
              role="option"
              aria-selected={isSelected}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors"
              style={{
                background: isSelected ? "rgba(88,101,242,0.2)" : "transparent",
                color: "var(--theme-text-normal)",
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(suggestion)
              }}
            >
              <Avatar className="w-6 h-6">
                {persona.avatar_url && <AvatarImage src={persona.avatar_url} />}
                <AvatarFallback
                  style={{ background: "var(--theme-ai-badge-bg, #5865f2)", color: "var(--theme-ai-badge-text, white)", fontSize: "10px" }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium truncate">{persona.name}</span>
              <span
                className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-bold uppercase"
                style={{ background: "var(--theme-ai-badge-bg, rgba(88,101,242,0.3))", color: "var(--theme-ai-badge-text, #5865f2)" }}
              >
                <Bot className="w-2.5 h-2.5" /> BOT
              </span>
              {persona.description && (
                <span className="text-[10px] truncate max-w-[120px]" style={{ color: "var(--theme-text-muted)" }}>
                  {persona.description}
                </span>
              )}
              <span
                className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ color: confidenceTone, background: `${confidenceTone}26` }}
              >
                {confidence}
              </span>
            </button>
          )
        }

        // Member suggestion
        const member = suggestion.data
        const displayName = member.nickname || member.display_name || member.username
        const initials = displayName.slice(0, 2).toUpperCase()
        const confidence = getMemberMatchConfidence(member, query)
        const confidenceTone =
          confidence === "Exact" ? "#3ba55d" : confidence === "Strong" ? "#5865f2" : "#faa81a"

        return (
          <button
            key={`member-${member.user_id}`}
            role="option"
            aria-selected={isSelected}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(88,101,242,0.2)" : "transparent",
              color: "var(--theme-text-normal)",
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(suggestion)
            }}
          >
            <Avatar className="w-6 h-6">
              {member.avatar_url && <AvatarImage src={member.avatar_url} />}
              <AvatarFallback
                style={{ background: "var(--theme-accent)", color: "white", fontSize: "10px" }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium truncate">{displayName}</span>
            {displayName !== member.username && (
              <span className="text-xs truncate" style={{ color: "var(--theme-text-muted)" }}>
                {member.username}
              </span>
            )}
            <span
              className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ color: confidenceTone, background: `${confidenceTone}26` }}
            >
              {confidence}
            </span>
          </button>
        )
      })}
    </div>
  )
}
