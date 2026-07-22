import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"

/**
 * GET /api/turn-credentials
 *
 * Returns time-limited TURN credentials generated via HMAC-based auth
 * (TURN REST API, draft-uberti-behave-turn-rest-00).
 *
 * Requires an authenticated user session. Credentials expire after 24 hours.
 */

const TURN_TTL_SECONDS = 24 * 60 * 60 // 24 hours

export async function GET(): Promise<NextResponse> {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const turnUrl = process.env.TURN_URL
    const turnsUrl = process.env.TURNS_URL
    const turnSecret = process.env.TURN_SECRET

    if (!turnUrl || !turnSecret) {
      return NextResponse.json({ error: "TURN not configured" }, { status: 503 })
    }

    const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS
    // Opaque pseudonym so the raw user.id doesn't leak into coturn logs / browser diagnostics
    const opaqueId = crypto.createHash("sha256").update(user.id).digest("hex").slice(0, 16)
    // coturn ephemeral credential format: "<expiry>:<identifier>"
    const username = `${expiry}:${opaqueId}`
    const credential = crypto
      .createHmac("sha1", turnSecret)
      .update(username)
      .digest("base64")

    const urls: string[] = [turnUrl]
    if (turnsUrl) urls.push(turnsUrl)

    return NextResponse.json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls, username, credential },
      ],
      ttl: TURN_TTL_SECONDS,
    })
  } catch (err) {
    console.error("[turn-credentials GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
