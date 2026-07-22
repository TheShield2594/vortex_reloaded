"use client"

import { useRef, useEffect } from "react"
import type { EmojiMatch } from "@/hooks/use-emoji-autocomplete"

interface Props {
  matches: EmojiMatch[]
  selectedIndex: number
  onSelect: (match: EmojiMatch) => void
}

export function EmojiSuggestions({ matches, selectedIndex, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  if (matches.length === 0) return null

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Emoji suggestions"
      className="rounded-lg shadow-xl overflow-y-auto max-h-52 py-1"
      style={{
        background: "var(--theme-bg-secondary)",
        border: "1px solid var(--theme-bg-tertiary)",
      }}
    >
      {matches.map((match, i) => {
        const isSelected = i === selectedIndex
        return (
          <button
            key={match.shortcode}
            role="option"
            aria-selected={isSelected}
            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(88,101,242,0.2)" : "transparent",
              color: "var(--theme-text-normal)",
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(match)
            }}
          >
            {match.isCustom && match.imageUrl ? (
              <img src={match.imageUrl} alt={match.shortcode} className="w-5 h-5 object-contain" />
            ) : (
              <span className="text-lg w-5 text-center leading-none">{match.emoji}</span>
            )}
            <span className="text-sm" style={{ color: "var(--theme-text-muted)" }}>
              :{match.shortcode}:
            </span>
          </button>
        )
      })}
    </div>
  )
}
