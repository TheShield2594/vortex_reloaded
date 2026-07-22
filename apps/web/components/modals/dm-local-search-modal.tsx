"use client"

/**
 * DmLocalSearchModal
 *
 * Search UI for encrypted DM channels / group DMs.  Unlike the server-side
 * SearchModal, this component queries the client-side LocalSearchIndex so
 * that plaintext never leaves the device.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import { Search, X, Loader2, ShieldCheck, Calendar } from "lucide-react"
import { format } from "date-fns"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { BrandedEmptyState } from "@/components/ui/branded-empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import type { LocalSearchResult } from "@/lib/local-search-index"

interface Props {
  /** The DM channel being searched. */
  channelId: string
  /** Human-readable name shown in the placeholder (e.g. partner username). */
  channelLabel?: string
  /** Called when the user clicks a result to jump to that message. */
  onJumpToMessage?: (channelId: string, messageId: string) => void
  onClose: () => void
  /**
   * The search function — inject this from the useLocalSearch hook so the
   * modal doesn't need to import the singleton directly.
   */
  searchFn: (query: string, channelId?: string, limit?: number) => LocalSearchResult[]
  /** Total indexed doc count for this channel (shown as index coverage hint). */
  indexedCount?: number
}

export function DmLocalSearchModal({
  channelId,
  channelLabel,
  onJumpToMessage,
  onClose,
  searchFn,
  indexedCount,
}: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<LocalSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up pending timers on unmount to prevent state updates after destroy.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      debounceRef.current = null
      searchTimerRef.current = null
    }
  }, [])

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onClose])

  const runSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([])
        return
      }
      setSearching(true)
      // The local index is synchronous; wrap in setTimeout so the spinner
      // appears before the (potentially large) search executes.
      searchTimerRef.current = setTimeout(() => {
        const found = searchFn(q, channelId, 40)
        setResults(found)
        setSearching(false)
        searchTimerRef.current = null
      }, 0)
    },
    [searchFn, channelId]
  )

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(v), 200)
  }

  const placeholderLabel = channelLabel ? `Search in ${channelLabel}` : "Search messages…"

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ background: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dm-search-title"
      aria-describedby="dm-search-desc"
      tabIndex={0}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--theme-bg-secondary)", maxHeight: "70vh" }}
      >
        <h2 id="dm-search-title" className="sr-only">Search Direct Messages</h2>
        <p id="dm-search-desc" className="sr-only">Search messages in this conversation</p>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: "var(--theme-bg-tertiary)" }}
        >
          <Search className="w-5 h-5 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            value={query}
            onChange={handleInput}
            placeholder={`${placeholderLabel} — try from:<userId> before:2026-01-01`}
            className="flex-1 bg-transparent text-white text-sm focus:outline-none"
          />
          {searching && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />}
          <button type="button" onClick={onClose} aria-label="Close search">
            <X className="w-5 h-5" style={{ color: "var(--theme-text-muted)" }} />
          </button>
        </div>

        {/* Private-search notice */}
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-[11px]"
          style={{ color: "var(--theme-text-muted)", background: "var(--theme-bg-tertiary)" }}
        >
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
          <span>
            Local search — messages are searched <strong>on this device only</strong> and are never sent to the server.
            {typeof indexedCount === "number" && (
              <> &nbsp;{indexedCount.toLocaleString()} message{indexedCount === 1 ? "" : "s"} indexed.</>
            )}
          </span>
        </div>

        {/* Filter hint */}
        <div className="px-4 py-1 text-[11px]" style={{ color: "var(--theme-text-muted)" }}>
          Filters:{" "}
          <code className="px-1 py-0.5 rounded bg-black/20">from:user-id</code>{" "}
          <code className="px-1 py-0.5 rounded bg-black/20">before:YYYY-MM-DD</code>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {!query.trim() ? (
            <div className="px-4 py-10">
              <BrandedEmptyState
                icon={Search}
                title="Search this conversation"
                description="Results are matched locally from your decrypted message cache."
              />
            </div>
          ) : results.length === 0 && !searching ? (
            <div className="px-4 py-10">
              <BrandedEmptyState
                icon={Calendar}
                title="No results"
                description={`No messages matched "${query}". Try a different term or scroll back to load more history.`}
              />
            </div>
          ) : (
            <>
              {searching && results.length === 0 && (
                <div className="space-y-3 px-4 py-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}
              {results.length > 0 && (
                <div className="px-4 py-2 text-xs" style={{ color: "var(--theme-text-muted)" }}>
                  {results.length} result{results.length === 1 ? "" : "s"}
                </div>
              )}
              {results.map((result) => {
                const displayName = result.authorName || "Unknown"
                const initials = displayName.slice(0, 2).toUpperCase()
                const highlighted = highlightTokens(result.text, result.matchedTokens)

                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => {
                      onJumpToMessage?.(result.channelId, result.id)
                      onClose()
                    }}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5"
                  >
                    <Avatar className="w-8 h-8 mt-0.5 flex-shrink-0">
                      {result.avatarUrl && <AvatarImage src={result.avatarUrl} />}
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="text-sm text-white">
                        {displayName}{" "}
                        <span className="text-xs text-zinc-400">
                          {format(new Date(result.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      <p
                        className="text-sm text-zinc-300 truncate"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: highlighted }}
                      />
                    </div>
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Wrap matched tokens in <mark> tags for display.
 * The input text is HTML-escaped before processing to prevent XSS.
 */
function highlightTokens(text: string, tokens: string[]): string {
  let escaped = escapeHtml(text)
  if (tokens.length === 0) return escaped

  // Build a single regex that matches any of the tokens (word-prefix match).
  const pattern = tokens
    .map((t) => escapeRegex(t))
    .join("|")
  const regex = new RegExp(`(${pattern}\\w*)`, "gi")
  return escaped.replace(regex, "<mark class=\"bg-yellow-400/30 text-white rounded px-0.5\">$1</mark>")
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
