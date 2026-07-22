"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Search, X, Loader2, Calendar, Link, Image, Paperclip, User, ChevronDown, ShieldCheck } from "lucide-react"
import { format } from "date-fns"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { BrandedEmptyState } from "@/components/ui/branded-empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils/cn"

interface SearchResultAuthor {
  display_name?: string
  username?: string
  avatar_url?: string
}

interface MessageSearchResult {
  type: "dm"
  id: string
  content: string
  channel_id: string
  created_at: string
  author_id?: string
  author?: SearchResultAuthor
}

type SearchResult = MessageSearchResult

interface ActiveFilters {
  from?: string
  has?: "link" | "image" | "file"
  before?: string
  after?: string
}

interface Props {
  dmChannelId: string
  dmChannelLabel?: string
  onClose: () => void
  onJumpToMessage?: (channelId: string, messageId: string) => void
}

function buildQueryString(text: string, filters: ActiveFilters): string {
  const parts: string[] = []
  if (text.trim()) parts.push(text.trim())
  if (filters.from) parts.push(`from:${filters.from}`)
  if (filters.has) parts.push(`has:${filters.has}`)
  if (filters.before) parts.push(`before:${filters.before}`)
  if (filters.after) parts.push(`after:${filters.after}`)
  return parts.join(" ")
}

const HAS_OPTIONS: { value: NonNullable<ActiveFilters["has"]>; label: string; icon: React.ElementType }[] = [
  { value: "link", label: "Link", icon: Link },
  { value: "image", label: "Image", icon: Image },
  { value: "file", label: "File", icon: Paperclip },
]

/** Search modal for a single DM/group conversation (server-side full-text search over non-E2E DMs). */
export function SearchModal({ dmChannelId, dmChannelLabel, onClose, onJumpToMessage }: Props) {
  const [text, setText] = useState("")
  const [filters, setFilters] = useState<ActiveFilters>({})
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      // Don't hijack arrow/enter keys while the user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1))
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        const r = results[selectedIndex]
        if (r && onJumpToMessage) {
          onJumpToMessage(r.channel_id, r.id)
          onClose()
        }
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onClose, results, selectedIndex, onJumpToMessage])

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(-1) }, [results])

  // Scroll selected result into view
  useEffect(() => {
    if (selectedIndex < 0 || !resultsRef.current) return
    const items = resultsRef.current.querySelectorAll("[data-result-index]")
    items[selectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const search = useCallback(async (t: string, f: ActiveFilters) => {
    const q = buildQueryString(t, f)
    if (!q.trim()) return setResults([])
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams({ q, limit: "40", dmChannelId })
      const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
      if (res.ok) {
        const data = await res.json()
        setResults(data.results ?? [])
        setTotal(data.total ?? 0)
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
      if (process.env.NODE_ENV !== "production") {
        console.error("[SearchModal] Search failed:", e)
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [dmChannelId])

  const scheduleSearch = useCallback((t: string, f: ActiveFilters) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { search(t, f) }, 300)
  }, [search])

  function handleTextInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setText(v)
    scheduleSearch(v, filters)
  }

  function removeFilter(key: keyof ActiveFilters) {
    const next = { ...filters }
    delete next[key]
    setFilters(next)
    scheduleSearch(text, next)
  }

  function applyFilter<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    scheduleSearch(text, next)
  }

  const hasActiveFilters = Object.keys(filters).length > 0
  const hasQuery = text.trim() || hasActiveFilters

  const placeholderText = `Search${dmChannelLabel ? ` in ${dmChannelLabel}` : " messages"}…`

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-modal-title"
      aria-describedby="search-modal-desc"
    >
      <div
        className="w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--theme-bg-secondary)", maxHeight: "70vh" }}
      >
        <h2 id="search-modal-title" className="sr-only">
          Search Direct Messages
        </h2>
        <p id="search-modal-desc" className="sr-only">
          Search messages in this conversation
        </p>
        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
          <Search className="w-5 h-5 flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            value={text}
            onChange={handleTextInput}
            placeholder={placeholderText}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: "var(--theme-text-normal)" }}
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "var(--theme-text-muted)" }} />}
          <button
            type="button"
            onClick={() => setShowFilterBar((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors flex-shrink-0 focus-ring"
            style={
              hasActiveFilters
                ? { background: "color-mix(in srgb, var(--theme-accent) 15%, transparent)", color: "var(--theme-accent)" }
                : { color: "var(--theme-text-muted)" }
            }
            aria-label="Toggle search filters"
            aria-pressed={showFilterBar}
          >
            Filters
            {hasActiveFilters && (
              <span
                className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: "var(--theme-accent)", color: "var(--theme-bg-primary)" }}
              >
                {Object.keys(filters).length}
              </span>
            )}
            <ChevronDown className={cn("w-3 h-3 transition-transform", showFilterBar && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="p-1 rounded transition-colors focus-ring"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter bar */}
        {showFilterBar && (
          <div
            className="px-4 py-2.5 border-b flex flex-wrap gap-2 items-center"
            style={{ borderColor: "var(--theme-bg-tertiary)", background: "color-mix(in srgb, var(--theme-bg-tertiary) 40%, var(--theme-bg-secondary))" }}
          >
            {/* has: filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium" style={{ color: "var(--theme-text-muted)" }}>Has:</span>
              {HAS_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => filters.has === value ? removeFilter("has") : applyFilter("has", value)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
                  style={
                    filters.has === value
                      ? { background: "var(--theme-accent)", color: "var(--theme-bg-primary)" }
                      : { background: "var(--theme-surface-elevated)", color: "var(--theme-text-secondary)" }
                  }
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>

            {/* from: filter */}
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3" style={{ color: "var(--theme-text-muted)" }} />
              {filters.from ? (
                <span
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: "var(--theme-accent)", color: "var(--theme-bg-primary)" }}
                >
                  {filters.from}
                  <button type="button" onClick={() => removeFilter("from")} aria-label="Remove from filter">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const val = (e.currentTarget.elements.namedItem("from") as HTMLInputElement).value.trim()
                    if (val) applyFilter("from", val)
                    e.currentTarget.reset()
                  }}
                >
                  <input
                    name="from"
                    placeholder="from:user-id"
                    className="text-xs px-2 py-0.5 rounded focus:outline-none"
                    style={{ background: "var(--theme-surface-elevated)", color: "var(--theme-text-secondary)", width: 120 }}
                  />
                </form>
              )}
            </div>

            {/* date range filters */}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3" style={{ color: "var(--theme-text-muted)" }} />
              <input
                type="date"
                aria-label="After date"
                title="After date"
                value={filters.after ?? ""}
                className="text-xs px-2 py-0.5 rounded focus:outline-none"
                style={{ background: "var(--theme-surface-elevated)", color: "var(--theme-text-secondary)" }}
                onChange={(e) => { if (e.target.value) applyFilter("after", e.target.value); else removeFilter("after") }}
              />
              <span className="text-xs" style={{ color: "var(--theme-text-faint)" }}>→</span>
              <input
                type="date"
                aria-label="Before date"
                title="Before date"
                value={filters.before ?? ""}
                className="text-xs px-2 py-0.5 rounded focus:outline-none"
                style={{ background: "var(--theme-surface-elevated)", color: "var(--theme-text-secondary)" }}
                onChange={(e) => { if (e.target.value) applyFilter("before", e.target.value); else removeFilter("before") }}
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilters({}); scheduleSearch(text, {}) }}
                className="ml-auto text-xs px-2 py-0.5 rounded transition-colors"
                style={{ color: "var(--theme-danger)" }}
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Active filter chips (collapsed filter bar) */}
        {!showFilterBar && hasActiveFilters && (
          <div className="px-4 py-1.5 flex flex-wrap gap-1.5 border-b" style={{ borderColor: "var(--theme-bg-tertiary)" }}>
            {(["from", "has", "before", "after"] as const).map((key) => {
              const val = filters[key]
              if (!val) return null
              return (
                <span
                  key={key}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: "color-mix(in srgb, var(--theme-accent) 15%, transparent)", color: "var(--theme-accent)", border: "1px solid color-mix(in srgb, var(--theme-accent) 30%, transparent)" }}
                >
                  {key}:{val}
                  <button type="button" onClick={() => removeFilter(key)} aria-label={`Remove ${key} filter`}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Results */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto">
          {!hasQuery
            ? <div className="px-4 py-10">
                <BrandedEmptyState
                  icon={Search}
                  title="Search this conversation"
                  description="Find messages in this conversation using server-side full-text search."
                />
              </div>
            : results.length === 0 && !loading
              ? <div className="px-4 py-10"><BrandedEmptyState icon={Calendar} title="No results" description="Nothing matched — try different keywords or adjust your filters." /></div>
              : <>
                {loading && results.length === 0 && (
                  <div className="space-y-3 px-4 py-4">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                )}
                {total > 0 && <div className="px-4 py-2 text-xs" style={{ color: "var(--theme-text-muted)" }}>{total} result{total !== 1 ? "s" : ""}</div>}
                {results.map((result, idx) => {
                  const displayName = result.author?.display_name || result.author?.username || "Unknown"
                  const initials = displayName.slice(0, 2).toUpperCase()
                  return (
                    <button
                      key={`dm-${result.id}`}
                      data-result-index={idx}
                      onClick={() => { onJumpToMessage?.(result.channel_id, result.id); onClose() }}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
                      style={{
                        borderBottom: "1px solid var(--theme-bg-tertiary)",
                        background: idx === selectedIndex ? "var(--theme-surface-elevated)" : undefined,
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Avatar className="w-8 h-8 mt-0.5 flex-shrink-0">
                        {result.author?.avatar_url && <AvatarImage src={result.author.avatar_url} />}
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium flex items-baseline gap-2" style={{ color: "var(--theme-text-bright)" }}>
                          {displayName}
                          <span className="text-xs font-normal" style={{ color: "var(--theme-text-faint)" }}>
                            {format(new Date(result.created_at), "MMM d, yyyy h:mm a")}
                          </span>
                        </div>
                        <p className="text-sm truncate" style={{ color: "var(--theme-text-secondary)" }}>{result.content}</p>
                      </div>
                    </button>
                  )
                })}
              </>
          }
        </div>

        <div className="px-4 py-2 border-t text-[11px] flex items-center gap-2" style={{ borderColor: "var(--theme-bg-tertiary)", color: "var(--theme-text-faint)" }}>
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
          <span>Server-side search — non-E2E DMs are searched via Postgres full-text search.</span>
        </div>
      </div>
    </div>
  )
}
