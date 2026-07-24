import { useCallback } from "react"
import { EMOJI_ENTRIES } from "@/lib/emoji-data"
import { useAutocomplete } from "./use-autocomplete"

export interface EmojiMatch {
  shortcode: string
  emoji: string
}

interface Options {
  content: string
  cursorPosition: number
}

interface Result {
  isOpen: boolean
  query: string | null
  matches: EmojiMatch[]
  selectedIndex: number
  selectEmoji: (match: EmojiMatch) => { newContent: string; newCursorPosition: number }
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  close: () => void
}

/** Minimum characters after `:` before showing suggestions */
const MIN_QUERY_LENGTH = 2

function findEmojiQuery(text: string, cursor: number): string | null {
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === ":") {
      // `:` must be at start of string or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, cursor)
        // Don't trigger if query contains spaces (user typed past the shortcode)
        if (/\s/.test(query)) return null
        return query
      }
      return null
    }
    // Hit whitespace before finding `:` — no active emoji query
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

export function useEmojiAutocomplete({ content, cursorPosition }: Options): Result {
  const filter = useCallback(
    (query: string) => {
      if (query.length < MIN_QUERY_LENGTH) return []
      const lower = query.toLowerCase()
      const results: EmojiMatch[] = []

      // Search standard Unicode emojis
      for (const [shortcode, char] of EMOJI_ENTRIES) {
        if (shortcode.includes(lower)) {
          results.push({ shortcode, emoji: char })
        }
        if (results.length >= 20) break
      }

      // Sort: starts-with first, then substring matches
      results.sort((a, b) => {
        const aStarts = a.shortcode.startsWith(lower) ? 0 : 1
        const bStarts = b.shortcode.startsWith(lower) ? 0 : 1
        if (aStarts !== bStarts) return aStarts - bStarts
        return a.shortcode.localeCompare(b.shortcode)
      })

      return results.slice(0, 10)
    },
    []
  )

  const { isOpen, query, matches, selectedIndex, handleKeyDown, close } = useAutocomplete({
    findQuery: findEmojiQuery,
    filter,
    content,
    cursorPosition,
  })

  function selectEmoji(match: EmojiMatch) {
    const colonIndex = content.lastIndexOf(":", cursorPosition - 1)
    const before = content.slice(0, colonIndex)
    const after = content.slice(cursorPosition)

    // Insert the Unicode emoji character directly
    const replacement = match.emoji + " "
    return {
      newContent: before + replacement + after,
      newCursorPosition: before.length + replacement.length,
    }
  }

  return { isOpen, query, matches, selectedIndex, selectEmoji, handleKeyDown, close }
}
