import { NextRequest, NextResponse } from "next/server"
import { detectProvider, klipyTrendingMemes, type GifResult } from "@/lib/gif-provider"
import { requireAuth } from "@/lib/utils/api-helpers"
import { rateLimiter } from "@/lib/rate-limit"

const TRENDING_TTL_MS = 10 * 60 * 1000 // 10 minutes

let trendingCache: { data: GifResult[]; expiresAt: number } | null = null

export async function GET(request: NextRequest) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const rl = await rateLimiter.check(`meme:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rl.allowed) return NextResponse.json([], { status: 429 })

  const config = detectProvider()
  if (!config) return NextResponse.json([])

  // Memes are only available via Klipy
  if (config.provider !== "klipy") return NextResponse.json([])

  if (trendingCache && trendingCache.expiresAt > Date.now()) {
    return NextResponse.json(trendingCache.data)
  }

  try {
    const mapped = await klipyTrendingMemes(config.apiKey)

    trendingCache = { data: mapped, expiresAt: Date.now() + TRENDING_TTL_MS }
    return NextResponse.json(mapped)
  } catch {
    return NextResponse.json([], { status: 502 })
  }
}
