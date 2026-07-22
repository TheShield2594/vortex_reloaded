import { NextRequest, NextResponse } from "next/server"
import { detectProvider, giphyTrending, klipyTrending, type GifResult } from "@/lib/gif-provider"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"

const TRENDING_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Module-level cache — survives across requests within the same serverless instance
let trendingCache: { data: GifResult[]; expiresAt: number; provider: string } | null = null

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers) ?? "unknown"
  try {
    const rl = await rateLimiter.check(`gif:${ip}`, { limit: 30, windowMs: 60_000 })
    if (!rl.allowed) return NextResponse.json([], { status: 429 })
  } catch {
    // Fail open — don't block GIF trending if rate limiter is down
  }

  const config = detectProvider()
  if (!config) return NextResponse.json([])

  if (trendingCache && trendingCache.expiresAt > Date.now() && trendingCache.provider === config.provider) {
    return NextResponse.json(trendingCache.data)
  }

  try {
    const mapped = config.provider === "klipy"
      ? await klipyTrending(config.apiKey)
      : await giphyTrending(config.apiKey)

    trendingCache = { data: mapped, expiresAt: Date.now() + TRENDING_TTL_MS, provider: config.provider }
    return NextResponse.json(mapped)
  } catch {
    return NextResponse.json([], { status: 502 })
  }
}
