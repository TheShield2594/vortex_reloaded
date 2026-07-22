import { type NextRequest, NextResponse } from "next/server"
import { detectProvider, klipySearchMemes, type GifResult } from "@/lib/gif-provider"
import { requireAuth } from "@/lib/utils/api-helpers"
import { rateLimiter } from "@/lib/rate-limit"

const SEARCH_TTL_MS = 2 * 60 * 1000 // 2 minutes
const MAX_CACHE_ENTRIES = 200

const searchCache = new Map<string, { data: GifResult[]; expiresAt: number }>()

export async function GET(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const rl = await rateLimiter.check(`meme:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rl.allowed) return NextResponse.json([], { status: 429 })

  const config = detectProvider()
  if (!config) return NextResponse.json([])

  // Memes are only available via Klipy
  if (config.provider !== "klipy") return NextResponse.json([])

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json([])

  const cacheKey = `klipy:meme:${q.toLowerCase()}`
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const mapped = await klipySearchMemes(config.apiKey, q)

    searchCache.set(cacheKey, { data: mapped, expiresAt: Date.now() + SEARCH_TTL_MS })

    if (searchCache.size > MAX_CACHE_ENTRIES) {
      const now = Date.now()
      for (const [key, entry] of searchCache) {
        if (entry.expiresAt < now) searchCache.delete(key)
      }
      if (searchCache.size > MAX_CACHE_ENTRIES) {
        const excess = searchCache.size - MAX_CACHE_ENTRIES
        let removed = 0
        for (const key of searchCache.keys()) {
          if (removed >= excess) break
          searchCache.delete(key)
          removed++
        }
      }
    }

    return NextResponse.json(mapped)
  } catch {
    return NextResponse.json([], { status: 502 })
  }
}
