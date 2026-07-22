"use client"

import { useRef, useEffect } from "react"
import type { SlashCommand } from "@/hooks/use-slash-command-autocomplete"

interface Props {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}

export function SlashCommandSuggestions({ commands, selectedIndex, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (commands.length === 0) return null

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slash command suggestions"
      className="rounded-lg shadow-xl overflow-y-auto max-h-72 py-1"
      style={{
        background: "var(--theme-bg-secondary)",
        border: "1px solid var(--theme-bg-tertiary)",
      }}
    >
      <div
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--theme-text-muted)" }}
      >
        Commands
      </div>
      {commands.map((cmd, i) => {
        const isSelected = i === selectedIndex
        const isBuiltIn = cmd.appId === "builtin"
        return (
          <button
            key={cmd.id}
            role="option"
            aria-selected={isSelected}
            className="flex items-center gap-3 w-full px-3 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(88,101,242,0.2)" : "transparent",
              color: "var(--theme-text-normal)",
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(cmd)
            }}
          >
            <span
              className="text-sm font-mono font-semibold flex-shrink-0"
              style={{ color: "var(--theme-accent)" }}
            >
              /{cmd.commandName}
            </span>
            {cmd.description && (
              <span className="text-xs truncate flex-1" style={{ color: "var(--theme-text-muted)" }}>
                {cmd.description}
              </span>
            )}
            <span
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                color: isBuiltIn ? "var(--theme-accent)" : "var(--theme-text-muted)",
                background: "var(--theme-bg-tertiary)",
              }}
            >
              {cmd.appName}
            </span>
          </button>
        )
      })}
    </div>
  )
}
