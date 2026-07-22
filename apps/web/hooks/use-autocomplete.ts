"use client"

import { useState, useMemo, useEffect, useCallback } from "react"

/**
 * Generic autocomplete state hook — extracts the shared keyboard navigation,
 * selection, and dismiss logic duplicated across:
 *   - use-mention-autocomplete.ts
 *   - use-emoji-autocomplete.ts
 *   - use-slash-command-autocomplete.ts
 */

interface UseAutocompleteConfig<T> {
  /** Extract the trigger query from the input text at the cursor position. Return null when inactive. */
  findQuery: (text: string, cursor: number) => string | null
  /** Filter/rank items given the active query string. */
  filter: (query: string) => T[]
  /** Current input text. */
  content: string
  /** Current cursor position within the input. */
  cursorPosition: number
}

interface UseAutocompleteReturn<T> {
  isOpen: boolean
  query: string | null
  matches: T[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  /** Returns true if the event was handled (consumed). */
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  close: () => void
}

export function useAutocomplete<T>({
  findQuery,
  filter,
  content,
  cursorPosition,
}: UseAutocompleteConfig<T>): UseAutocompleteReturn<T> {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const query = useMemo(
    () => findQuery(content, cursorPosition),
    [content, cursorPosition, findQuery]
  )

  const matches = useMemo(() => {
    if (query === null) return []
    return filter(query)
  }, [query, filter])

  const isOpen = query !== null && matches.length > 0 && !dismissed

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [matches.length, query])

  // Un-dismiss when query changes (user keeps typing after Escape)
  useEffect(() => {
    setDismissed(false)
  }, [query])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen) return false

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => (prev <= 0 ? matches.length - 1 : prev - 1))
          return true
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) => (prev >= matches.length - 1 ? 0 : prev + 1))
          return true
        case "Escape":
          e.preventDefault()
          setDismissed(true)
          return true
        default:
          return false
      }
    },
    [isOpen, matches.length]
  )

  const close = useCallback(() => {
    setDismissed(true)
  }, [])

  return { isOpen, query, matches, selectedIndex, setSelectedIndex, handleKeyDown, close }
}
