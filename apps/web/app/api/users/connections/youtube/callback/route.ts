import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isUserConnectionsTableMissing } from "@/lib/supabase/user-connections-errors"

const FETCH_TIMEOUT_MS = 8_000

interface GoogleTokenResponse {
  access_token?: string
  error?: string
}

interface YouTubeChannelSnippet {
  title?: string
  customUrl?: string
  thumbnails?: { high?: { url?: string } }
}

interface YouTubeChannelStatistics {
  subscriberCount?: string
  videoCount?: string
  viewCount?: string
}

interface YouTubeChannel {
  id?: string
  snippet?: YouTubeChannelSnippet
  statistics?: YouTubeChannelStatistics
}

interface YouTubeChannelListResponse {
  items?: YouTubeChannel[]
}

import { sanitizeNextPath } from "@/lib/auth/sanitize-redirect"

function buildRedirect(base: URL, nextPath: string, status: string): URL {
  const safe = sanitizeNextPath(nextPath)
  const target = new URL(safe, base.origin)
  target.searchParams.set("connections", status)
  return target
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  try {
    const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    })

    if (!res.ok) return null
    const data = (await res.json()) as GoogleTokenResponse
    return data.access_token ?? null
  } catch {
    return null
  }
}

async function fetchYouTubeChannel(accessToken: string): Promise<YouTubeChannel | null> {
  try {
    const res = await fetchWithTimeout(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    )

    if (!res.ok) return null
    const data = (await res.json()) as YouTubeChannelListResponse
    return data.items?.[0] ?? null
  } catch {
    return null
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)

  // Parse state — format is "randomHex:encodedNextPath"
  const rawState = url.searchParams.get("state") || ""
  const colonIdx = rawState.indexOf(":")
  const stateToken = colonIdx > 0 ? rawState.slice(0, colonIdx) : rawState
  const nextPath = colonIdx > 0 ? decodeURIComponent(rawState.slice(colonIdx + 1)) : "/"

  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "youtube_auth_required"))
    }

    const cookieStore = await cookies()
    const expectedState = cookieStore.get("youtube_oauth_state")?.value

    if (!stateToken || !expectedState || stateToken !== expectedState) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "youtube_state_invalid"))
    }

    const code = url.searchParams.get("code")
    if (!code) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "youtube_no_code"))
    }

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
    const redirectUri = `${origin}/api/users/connections/youtube/callback`
    const accessToken = await exchangeCodeForToken(code, redirectUri)
    if (!accessToken) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "youtube_token_failed"))
    }

    const channel = await fetchYouTubeChannel(accessToken)
    if (!channel?.id) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "youtube_no_channel"))
    }

    const snippet = channel.snippet
    const stats = channel.statistics
    const channelHandle = snippet?.customUrl ?? null
    const channelTitle = snippet?.title ?? null

    const profileUrl = channelHandle
      ? `https://youtube.com/${channelHandle}`
      : `https://youtube.com/channel/${channel.id}`

    const { error } = await supabase
      .from("user_connections")
      .upsert({
        user_id: user.id,
        provider: "youtube",
        provider_user_id: channel.id,
        username: channelHandle ?? channel.id,
        display_name: channelTitle,
        profile_url: profileUrl,
        metadata: {
          linked_via: "google_oauth",
          ...(snippet?.thumbnails?.high?.url ? { avatar_url: snippet.thumbnails.high.url } : {}),
          ...(stats?.subscriberCount ? { subscriber_count: Number(stats.subscriberCount) } : {}),
          ...(stats?.videoCount ? { video_count: Number(stats.videoCount) } : {}),
          ...(stats?.viewCount ? { view_count: Number(stats.viewCount) } : {}),
        },
      }, { onConflict: "user_id,provider" })

    const status = !error
      ? "youtube_linked"
      : isUserConnectionsTableMissing(error)
        ? "connections_storage_unavailable"
        : "youtube_save_failed"

    const response = NextResponse.redirect(buildRedirect(url, nextPath, status))
    response.cookies.delete("youtube_oauth_state")
    return response
  } catch (err) {
    console.error("YouTube callback error", { route: "GET /api/users/connections/youtube/callback", error: err instanceof Error ? err.message : String(err) })
    const response = NextResponse.redirect(buildRedirect(url, nextPath, "youtube_save_failed"))
    response.cookies.delete("youtube_oauth_state")
    return response
  }
}
