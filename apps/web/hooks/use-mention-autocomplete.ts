import { useCallback } from "react"
import type { MemberForMention, RoleForMention, PersonaForMention } from "@/lib/stores/app-store"
import { useAutocomplete } from "./use-autocomplete"

export type MentionSuggestion =
  | { type: "member"; data: MemberForMention }
  | { type: "role"; data: RoleForMention }
  | { type: "persona"; data: PersonaForMention }

interface Options {
  content: string
  cursorPosition: number
  members: MemberForMention[]
  roles?: RoleForMention[]
  personas?: PersonaForMention[]
}

interface Result {
  isOpen: boolean
  query: string | null
  filteredMembers: MemberForMention[]
  filteredSuggestions: MentionSuggestion[]
  selectedIndex: number
  selectSuggestion: (suggestion: MentionSuggestion) => { newContent: string; newCursorPosition: number }
  selectMember: (member: MemberForMention) => { newContent: string; newCursorPosition: number }
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  close: () => void
}

function findMentionQuery(text: string, cursor: number): string | null {
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === "@") {
      // @ must be at start of string or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        return text.slice(i + 1, cursor)
      }
      return null
    }
    // Hit whitespace before finding @ — no active mention
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

export function useMentionAutocomplete({ content, cursorPosition, members, roles = [], personas = [] }: Options): Result {
  const filter = useCallback(
    (query: string): MentionSuggestion[] => {
      const lower = query.toLowerCase()

      const memberResults: MentionSuggestion[] = members
        .filter(
          (m) =>
            m.username.toLowerCase().includes(lower) ||
            (m.display_name?.toLowerCase().includes(lower) ?? false) ||
            (m.nickname?.toLowerCase().includes(lower) ?? false)
        )
        .slice(0, 8)
        .map((m) => ({ type: "member", data: m }))

      const roleResults: MentionSuggestion[] = roles
        .filter((r) => r.mentionable && r.name.toLowerCase().includes(lower))
        .slice(0, 4)
        .map((r) => ({ type: "role", data: r }))

      const personaResults: MentionSuggestion[] = personas
        .filter((p) => p.name.toLowerCase().includes(lower))
        .slice(0, 4)
        .map((p) => ({ type: "persona", data: p }))

      return [...personaResults, ...roleResults, ...memberResults].slice(0, 10)
    },
    [members, roles, personas]
  )

  const { isOpen, query, matches, selectedIndex, handleKeyDown, close } = useAutocomplete({
    findQuery: findMentionQuery,
    filter,
    content,
    cursorPosition,
  })

  function selectSuggestion(suggestion: MentionSuggestion): { newContent: string; newCursorPosition: number } {
    const atIndex = content.lastIndexOf("@", cursorPosition - 1)
    const before = content.slice(0, atIndex)
    const after = content.slice(cursorPosition)

    let mention: string
    if (suggestion.type === "role") {
      mention = `<@&${suggestion.data.id}> `
    } else if (suggestion.type === "persona") {
      mention = `<@bot:${suggestion.data.id}> `
    } else {
      mention = `<@${suggestion.data.username}> `
    }

    return {
      newContent: before + mention + after,
      newCursorPosition: before.length + mention.length,
    }
  }

  // Backwards-compatible: select a member directly
  function selectMember(member: MemberForMention): { newContent: string; newCursorPosition: number } {
    return selectSuggestion({ type: "member", data: member })
  }

  return {
    isOpen,
    query,
    filteredMembers: matches.filter((s): s is MentionSuggestion & { type: "member" } => s.type === "member").map((s) => s.data),
    filteredSuggestions: matches,
    selectedIndex,
    selectSuggestion,
    selectMember,
    handleKeyDown,
    close,
  }
}
