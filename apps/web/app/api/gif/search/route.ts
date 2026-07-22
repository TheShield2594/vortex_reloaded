import { type NextRequest, NextResponse } from "next/server"
import { detectProvider, giphySearch, klipySearch, type GifResult } from "@/lib/gif-provider"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"

const SEARCH_TTL_MS = 2 * 60 * 1000 // 2 minutes
const MAX_CACHE_ENTRIES = 200

// Module-level LRU-ish cache keyed by lowercase query
const searchCache = new Map<string, { data: GifResult[]; expiresAt: number }>()

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers) ?? "unknown"
  try {
    const rl = await rateLimiter.check(`gif:${ip}`, { limit: 30, windowMs: 60_000 })
    if (!rl.allowed) return NextResponse.json([], { status: 429 })
  } catch {
    // Fail open — don't block GIF search if rate limiter is down
  }

  const config = detectProvider()
  if (!config) return NextResponse.json([])

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json([])

  const cacheKey = `${config.provider}:${q.toLowerCase()}`
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const mapped = config.provider === "klipy"
      ? await klipySearch(config.apiKey, q)
      : await giphySearch(config.apiKey, q)

    searchCache.set(cacheKey, { data: mapped, expiresAt: Date.now() + SEARCH_TTL_MS })

    // Evict expired entries when cache grows large
    if (searchCache.size > MAX_CACHE_ENTRIES) {
      const now = Date.now()
      for (const [key, entry] of searchCache) {
        if (entry.expiresAt < now) searchCache.delete(key)
      }
    }

    return NextResponse.json(mapped)
  } catch {
    return NextResponse.json([], { status: 502 })
  }
}
