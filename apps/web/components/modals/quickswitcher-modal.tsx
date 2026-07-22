"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Hash, Volume2, MessageSquare, Mic2, Megaphone, Image, Loader2, User } from "lucide-react"
import { createClientSupabaseClient } from "@/lib/supabase/client"

type IconType = typeof Hash

const CHANNEL_ICONS: Record<string, IconType> = {
  voice: Volume2,
  stage: Mic2,
  forum: MessageSquare,
  announcement: Megaphone,
  media: Image,
}

function fuzzyScore(candidate: string, q: string): number {
  const value = candidate.toLowerCase()
  const queryValue = q.toLowerCase().trim()
  if (!queryValue) return 0
  if (value === queryValue) return 1000
  if (value.startsWith(queryValue)) return 700 - (value.length - queryValue.length)
  if (value.includes(queryValue)) return 500 - value.indexOf(queryValue)

  let score = 0
  let cursor = 0
  for (const ch of queryValue) {
    const idx = value.indexOf(ch, cursor)
    if (idx === -1) return -1
    score += 20 - Math.min(19, idx - cursor)
    cursor = idx + 1
  }
  return score
}

interface Result {
  type: "channel" | "server" | "user"
  id: string
  name: string
  serverId?: string
  channelType?: string
  username?: string
}

interface Props {
  onClose: () => void
}

export function QuickSwitcherModal({ onClose }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [supabase] = useState(() => createClientSupabaseClient())
  const onCloseRef = useRef(onClose)
  const navigateRef = useRef<(r: Result) => void>(null!)
  onCloseRef.current = onClose

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)) }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
      if (e.key === "Enter" && results[selected]) { navigateRef.current(results[selected]) }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [results, selected])

  useEffect(() => {
    let cancelled = false

    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return () => { cancelled = true }
    }

    const debounce = window.setTimeout(async () => {
      setLoading(true)
      const q = `%${query}%`

      try {
        const [{ data: channels }, { data: servers }, { data: usersByUsername }, { data: usersByDisplayName }] = await Promise.all([
          supabase
            .from("channels")
            .select("id, name, type, server_id")
            .ilike("name", q)
            .in("type", ["text", "voice", "forum", "stage", "announcement", "media"])
            .limit(40),
          supabase
            .from("servers")
            .select("id, name")
            .ilike("name", q)
            .limit(20),
          supabase
            .from("users")
            .select("id, username, display_name")
            .ilike("username", q)
            .limit(25),
          supabase
            .from("users")
            .select("id, username, display_name")
            .ilike("display_name", q)
            .limit(25),
        ])

        const channelResults: Result[] = (channels ?? []).map((c) => ({
          type: "channel",
          id: c.id,
          name: c.name,
          serverId: c.server_id,
          channelType: c.type,
        }))
        const serverResults: Result[] = (servers ?? []).map((s) => ({
          type: "server",
          id: s.id,
          name: s.name,
        }))

        const mergedUsers = [...(usersByUsername ?? []), ...(usersByDisplayName ?? [])]
        const uniqueUsers = Array.from(new Map(mergedUsers.map((user) => [user.id, user])).values())
        const userResults: Result[] = uniqueUsers.map((u) => ({
          type: "user",
          id: u.id,
          name: u.display_name || u.username,
          username: u.username,
        }))

        const ranked = [...channelResults, ...serverResults, ...userResults]
          .map((entry) => ({
            entry,
            score: Math.max(
              fuzzyScore(entry.name, query),
              entry.username ? fuzzyScore(entry.username, query) - 1 : -1
            ),
          }))
          .filter((item) => item.score >= 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
          .map((item) => item.entry)

        if (cancelled) return
        setResults(ranked)
        setSelected(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(debounce)
    }
  }, [query, supabase])

  function navigate(result: Result) {
    if (result.type === "channel" && result.serverId) {
      router.push(`/channels/${result.serverId}/${result.id}`)
    } else if (result.type === "server") {
      router.push(`/channels/${result.id}`)
    } else if (result.type === "user") {
      router.push(`/friends?user=${encodeURIComponent(result.id)}`)
    }
    onCloseRef.current()
  }
  navigateRef.current = navigate

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xl rounded-xl overflow-hidden shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="qs-title" aria-describedby="qs-desc" style={{ background: "var(--theme-bg-secondary)" }}>
        <h2 id="qs-title" className="sr-only">Quick Switcher</h2>
        <p id="qs-desc" className="sr-only">Quickly jump to a channel or conversation</p>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
          {loading
            ? <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
            : <Search className="w-5 h-5 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />}
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Where would you like to go?"
            className="flex-1 bg-transparent text-white text-sm focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--theme-bg-tertiary)", color: "var(--theme-text-faint)" }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="py-1 max-h-72 overflow-y-auto">
            {results.map((r, i) => {
              const Icon = r.type === "user"
                ? User
                : r.type === "server"
                  ? Hash
                  : CHANNEL_ICONS[r.channelType ?? ""] ?? Hash

              return (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => navigate(r)}
                    onMouseEnter={() => setSelected(i)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                    style={{ background: selected === i ? "rgba(88,101,242,0.2)" : "transparent" }}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
                    <span className="text-sm text-white">{r.name}</span>
                    <span className="text-xs ml-auto" style={{ color: "var(--theme-text-faint)" }}>
                      {r.type === "channel" ? "Channel" : r.type === "server" ? "Server" : "User"}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {query && !loading && results.length === 0 && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--theme-text-muted)" }}>
            No results for &ldquo;{query}&rdquo;
          </div>
        )}

        {!query && (
          <div className="px-4 py-4 text-xs" style={{ color: "var(--theme-text-faint)" }}>
            <div className="flex justify-between mb-1"><span>Navigate channels</span><span>↑ ↓ to select, ↵ to go</span></div>
            <div className="flex justify-between"><span>Search servers</span><span>Ctrl+K to open</span></div>
          </div>
        )}
      </div>
    </div>
  )
}
