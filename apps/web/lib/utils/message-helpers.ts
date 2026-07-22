import { format, isToday, isYesterday } from "date-fns"

/** Format a date for the day separator between message groups. */
export function formatDaySeparator(date: Date): string {
  if (isToday(date)) return "Today"
  if (isYesterday(date)) return "Yesterday"
  return format(date, "MMMM d, yyyy")
}

/** Detect if a message is a standalone GIF URL (Klipy or Giphy media link). */
export function extractGifUrl(content: string | null): string | null {
  if (!content) return null
  const trimmed = content.trim()
  // Only treat messages that are a single URL (no surrounding text)
  if (!/^https?:\/\/\S+$/.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname
    // Klipy media URLs
    if ((host === "klipy.com" || host.endsWith(".klipy.com")) && /\.(gif|webp)(\?|$)/i.test(parsed.pathname)) {
      return trimmed
    }
    // Giphy media URLs
    if ((host === "media.giphy.com" || host.endsWith(".giphy.com") || host === "giphy.com" || host === "i.giphy.com") && /\.(gif|webp)(\?|$)/i.test(parsed.pathname)) {
      return trimmed
    }
    // Giphy page URLs — extract and build embeddable URL
    if (host === "giphy.com" || host === "www.giphy.com") {
      const idMatch = parsed.pathname.match(/-([a-zA-Z0-9]+)$/) ?? parsed.pathname.match(/\/media\/([a-zA-Z0-9]+)\//)
      if (idMatch?.[1]) return `https://media.giphy.com/media/${idMatch[1]}/giphy.gif`
    }
  } catch {
    // invalid URL
  }
  return null
}

/** Group reactions by emoji for display. */
export function groupReactionsByEmoji(
  reactions: ReadonlyArray<{ emoji: string; user_id: string }>,
  currentUserId: string
): Array<[string, { count: number; users: string[]; hasOwn: boolean }]> {
  const groups = new Map<string, { count: number; users: string[]; hasOwn: boolean }>()
  for (const r of reactions) {
    const current = groups.get(r.emoji) ?? { count: 0, users: [], hasOwn: false }
    current.count++
    current.users.push(r.user_id)
    if (r.user_id === currentUserId) current.hasOwn = true
    groups.set(r.emoji, current)
  }
  return Array.from(groups.entries())
}
