"use client"

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"

interface OGData {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  favicon: string | null
}

interface Props {
  url: string
}

function isGiphyHost(hostname: string): boolean {
  return hostname === "giphy.com"
    || hostname.endsWith(".giphy.com")
    || hostname === "gph.is"
    || hostname.endsWith(".gph.is")
}

function isKlipyHost(hostname: string): boolean {
  return hostname === "klipy.com" || hostname.endsWith(".klipy.com")
}

function isEmbeddableGiphyHost(hostname: string): boolean {
  return hostname === "giphy.com"
    || hostname === "www.giphy.com"
    || hostname.endsWith(".giphy.com")
}

// Extract first http(s) URL from message content, stripping trailing punctuation
export function extractFirstUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s>]+/)
  if (!match) return null
  return match[0].replace(/[.,)\]};:!?"']+$/, "")
}

export function extractGiphyUrl(content: string): string | null {
  const url = extractFirstUrl(content)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (isGiphyHost(parsed.hostname) || isKlipyHost(parsed.hostname)) {
      return url
    }
  } catch {
    return null
  }
  return null
}

export function stripUrlFromContent(content: string, url: string): string {
  return content.replace(url, "").replace(/\s{2,}/g, " ").trim()
}

export function getEmbeddableGiphyUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Klipy media URLs are directly embeddable
    if (isKlipyHost(parsed.hostname) && /\.(gif|webp)(\?|$)/i.test(parsed.pathname)) {
      return url
    }
    if (!isEmbeddableGiphyHost(parsed.hostname)) {
      return null
    }
    if (parsed.hostname === "media.giphy.com" && parsed.pathname.endsWith(".gif")) {
      return url
    }
    const idMatch = parsed.pathname.match(/-([a-zA-Z0-9]+)$/) ?? parsed.pathname.match(/\/media\/([a-zA-Z0-9]+)\//)
    const id = idMatch?.[1]
    if (!id) return null
    return `https://media.giphy.com/media/${id}/giphy.gif`
  } catch {
    return null
  }
}

// Module-level cache shared across all LinkEmbed instances within a session.
// Keyed by URL → resolved OGData (or null for failed fetches).
const oembedCache = new Map<string, OGData | null>()
// In-flight deduplication: if two components request the same URL concurrently,
// the second one reuses the first's promise instead of firing a second fetch.
const oembedInFlight = new Map<string, Promise<OGData | null | undefined>>()

function fetchOembed(url: string): Promise<OGData | null | undefined> {
  const existing = oembedInFlight.get(url)
  if (existing) return existing

  const promise = fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
    .then((r) => {
      if (!r.ok) {
        // 404 = definitive "no embed"; other errors are transient — don't cache
        if (r.status === 404) {
          oembedCache.set(url, null)
        }
        return undefined
      }
      return r.json() as Promise<OGData | null>
    })
    .then((d) => {
      if (d === undefined) return undefined
      if (!d || (!d.title && !d.description && !d.image)) {
        oembedCache.set(url, null)
        return null
      }
      oembedCache.set(url, d)
      return d
    })
    .catch((err: unknown) => {
      // Network error / transient failure — don't cache, allow retry
      let host = "unknown"
      try { host = new URL(url).host } catch {}
      console.warn("[link-embed] fetchOembed transient failure", {
        action: "fetchOembed",
        host,
        error: err instanceof Error ? err.message : String(err),
      })
      return undefined
    })
    .finally(() => {
      oembedInFlight.delete(url)
    }) as Promise<OGData | null | undefined>

  oembedInFlight.set(url, promise)
  return promise
}

export function LinkEmbed({ url }: Props) {
  const [data, setData] = useState<OGData | null>(() => oembedCache.get(url) ?? null)
  const [dataUrl, setDataUrl] = useState<string | null>(() => oembedCache.has(url) ? url : null)
  const [failed, setFailed] = useState(() => oembedCache.has(url) && oembedCache.get(url) === null)

  useEffect(() => {
    // Reset state when URL changes so stale failed/data don't persist
    setData(null)
    setDataUrl(null)
    setFailed(false)

    // Already have cached data — skip fetch
    if (oembedCache.has(url)) {
      const cached = oembedCache.get(url) ?? null
      setData(cached)
      setDataUrl(url)
      setFailed(cached === null)
      return
    }

    let cancelled = false
    fetchOembed(url).then((d) => {
      if (cancelled) return
      if (d === undefined) return // transient failure — leave as loading, allow retry on re-mount
      setData(d)
      setDataUrl(url)
      setFailed(d === null)
    })
    return () => { cancelled = true }
  }, [url])

  if (failed || !data || dataUrl !== url) return null

  // Truncate URL for display
  let displayUrl = url
  try { displayUrl = new URL(url).hostname } catch {}

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 rounded overflow-hidden max-w-lg hover:brightness-110 transition-all"
      style={{ background: "var(--theme-bg-secondary)", border: "1px solid var(--theme-bg-tertiary)", borderLeft: "4px solid var(--theme-accent)", textDecoration: "none" }}
    >
      <div className="p-3 flex gap-3">
        {/* Text side */}
        <div className="flex-1 min-w-0">
          {data.siteName && (
            <div className="text-xs mb-0.5" style={{ color: "var(--theme-text-muted)" }}>{data.siteName}</div>
          )}
          {data.title && (
            <div className="text-sm font-semibold truncate" style={{ color: "var(--theme-link)" }}>{data.title}</div>
          )}
          {data.description && (
            <div className="text-xs mt-1 line-clamp-2" style={{ color: "var(--theme-text-secondary)" }}>{data.description}</div>
          )}
          <div className="flex items-center gap-1 mt-1 text-xs" style={{ color: "var(--theme-text-faint)" }}>
            <ExternalLink className="w-3 h-3" />
            {displayUrl}
          </div>
        </div>
        {/* Thumbnail */}
        {data.image && (
          <div className="flex-shrink-0 w-20 h-16 rounded overflow-hidden" style={{ background: "var(--theme-bg-tertiary)" }}>
            <img
              src={data.image}
              alt={data.title || "Link preview"}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
          </div>
        )}
      </div>
    </a>
  )
}
