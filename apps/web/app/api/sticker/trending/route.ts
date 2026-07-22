import { NextRequest, NextResponse } from "next/server"
import { detectProvider, giphyTrendingStickers, klipyTrendingStickers, type GifResult } from "@/lib/gif-provider"
import { requireAuth } from "@/lib/utils/api-helpers"
import { rateLimiter } from "@/lib/rate-limit"

const TRENDING_TTL_MS = 10 * 60 * 1000 // 10 minutes

let trendingCache: { data: GifResult[]; expiresAt: number; provider: string } | null = null

export async function GET(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const rl = await rateLimiter.check(`sticker:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rl.allowed) return NextResponse.json([], { status: 429 })

  const config = detectProvider()
  if (!config) return NextResponse.json([])

  if (trendingCache && trendingCache.expiresAt > Date.now() && trendingCache.provider === config.provider) {
    return NextResponse.json(trendingCache.data)
  }

  try {
    const mapped = config.provider === "klipy"
      ? await klipyTrendingStickers(config.apiKey)
      : await giphyTrendingStickers(config.apiKey)

    trendingCache = { data: mapped, expiresAt: Date.now() + TRENDING_TTL_MS, provider: config.provider }
    return NextResponse.json(mapped)
  } catch {
    return NextResponse.json([], { status: 502 })
  }
}
