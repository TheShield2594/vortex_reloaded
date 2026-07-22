import { type NextRequest, NextResponse } from "next/server"
import { detectProvider, klipySuggestions } from "@/lib/gif-provider"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"

const GIPHY_BASE = "https://api.giphy.com/v1"
const SUGGESTIONS_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CACHE_ENTRIES = 100

// Module-level cache keyed by lowercase partial query
const suggestionsCache = new Map<string, { data: string[]; expiresAt: number }>()

/** GET /api/gif/suggestions?q=... — Returns search-term autocomplete suggestions. */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers) ?? "unknown"
  try {
    const rl = await rateLimiter.check(`gif:${ip}`, { limit: 30, windowMs: 60_000 })
    if (!rl.allowed) return NextResponse.json([], { status: 429 })
  } catch {
    // Fail open — don't block GIF suggestions if rate limiter is down
  }

  const config = detectProvider()
  if (!config) return NextResponse.json([])

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json([])

  const cacheKey = `${config.provider}:${q.toLowerCase()}`
  const cached = suggestionsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    let suggestions: string[]

    if (config.provider === "klipy") {
      suggestions = await klipySuggestions(config.apiKey, q)
    } else {
      // Giphy: use related tags endpoint
      const res = await fetch(
        `${GIPHY_BASE}/tags/related/${encodeURIComponent(q)}?api_key=${config.apiKey}`
      )
      if (!res.ok) return NextResponse.json([], { status: res.status })
      const json = await res.json()
      suggestions = (json.data ?? []).slice(0, 8).map((tag: { name: string }) => tag.name)
    }

    suggestionsCache.set(cacheKey, { data: suggestions, expiresAt: Date.now() + SUGGESTIONS_TTL_MS })

    // Evict expired entries when cache grows large
    if (suggestionsCache.size > MAX_CACHE_ENTRIES) {
      const now = Date.now()
      for (const [key, entry] of suggestionsCache) {
        if (entry.expiresAt < now) suggestionsCache.delete(key)
      }
    }

    return NextResponse.json(suggestions)
  } catch {
    return NextResponse.json([], { status: 502 })
  }
}
