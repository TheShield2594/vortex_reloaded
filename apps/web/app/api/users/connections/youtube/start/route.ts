import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { sanitizeNextPath } from "@/lib/auth/sanitize-redirect"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"

/**
 * GET /api/users/connections/youtube/start?next=/settings
 * Redirects the user to Google OAuth consent to authorize YouTube read access.
 * Requires GOOGLE_CLIENT_ID to be set.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) {
      return NextResponse.json({ error: "YouTube connection is not configured" }, { status: 503 })
    }

    const url = new URL(request.url)
    let origin = url.origin
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (appUrl) {
      try {
        const parsed = new URL(appUrl)
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          origin = parsed.origin
        }
      } catch {
        // Invalid NEXT_PUBLIC_APP_URL — fall back to request origin
      }
    }
    const next = sanitizeNextPath(url.searchParams.get("next") || "/")
    const state = randomBytes(16).toString("hex")

    const callbackUrl = `${origin}/api/users/connections/youtube/callback`

    const authUrl = new URL(GOOGLE_AUTH_URL)
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("redirect_uri", callbackUrl)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.readonly")
    authUrl.searchParams.set("access_type", "offline")
    authUrl.searchParams.set("prompt", "consent")
    authUrl.searchParams.set("state", `${state}:${encodeURIComponent(next)}`)

    const response = NextResponse.redirect(authUrl.toString())
    response.cookies.set("youtube_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: 60 * 10,
    })

    return response
  } catch (err) {
    console.error("YouTube start error", { route: "GET /api/users/connections/youtube/start", error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
