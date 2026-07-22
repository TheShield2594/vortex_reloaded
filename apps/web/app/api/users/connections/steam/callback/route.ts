import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isUserConnectionsTableMissing } from "@/lib/supabase/user-connections-errors"

async function verifySteamAssertion(searchParams: URLSearchParams) {
  const verificationParams = new URLSearchParams(searchParams)
  verificationParams.set("openid.mode", "check_authentication")

  const response = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verificationParams.toString(),
    cache: "no-store",
  })

  if (!response.ok) return false
  const body = await response.text()
  return body.includes("is_valid:true")
}

function extractSteamId(claimedId: string | null) {
  if (!claimedId) return null
  const match = claimedId.match(/\/id\/(\d+)$/)
  return match?.[1] ?? null
}

interface SteamPlayerSummary {
  personaname?: string
  avatarfull?: string
}

interface SteamOwnedGamesResponse {
  response?: { game_count?: number }
}

interface SteamPlayerSummaryResponse {
  response?: { players?: SteamPlayerSummary[] }
}

/** Fetch Steam profile summary + owned game count when STEAM_WEB_API_KEY is set. */
async function fetchSteamProfile(steamId: string): Promise<{ displayName: string | null; avatarUrl: string | null; gameCount: number | null }> {
  const apiKey = process.env.STEAM_WEB_API_KEY
  if (!apiKey) return { displayName: null, avatarUrl: null, gameCount: null }

  const result: { displayName: string | null; avatarUrl: string | null; gameCount: number | null } = {
    displayName: null,
    avatarUrl: null,
    gameCount: null,
  }

  try {
    const [summaryRes, gamesRes] = await Promise.allSettled([
      fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`, { cache: "no-store" }),
      fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&format=json`, { cache: "no-store" }),
    ])

    if (summaryRes.status === "fulfilled" && summaryRes.value.ok) {
      const data = (await summaryRes.value.json()) as SteamPlayerSummaryResponse
      const player = data?.response?.players?.[0]
      if (player) {
        result.displayName = player.personaname ?? null
        result.avatarUrl = player.avatarfull ?? null
      }
    }

    if (gamesRes.status === "fulfilled" && gamesRes.value.ok) {
      const data = (await gamesRes.value.json()) as SteamOwnedGamesResponse
      result.gameCount = data?.response?.game_count ?? null
    }
  } catch (err) {
    console.error("Steam enrichment failed", { steamId, error: err instanceof Error ? err.message : String(err) })
  }

  return result
}

import { sanitizeNextPath } from "@/lib/auth/sanitize-redirect"

function buildRedirect(base: URL, nextPath: string, status: string) {
  const safe = sanitizeNextPath(nextPath)
  const target = new URL(safe, base.origin)
  target.searchParams.set("connections", status)
  return target
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const nextPath = url.searchParams.get("next") || "/"

  try {
    const state = url.searchParams.get("state")

    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "steam_auth_required"))
    }

    const cookieStore = await cookies()
    const expectedState = cookieStore.get("steam_oauth_state")?.value

    if (!state || !expectedState || state !== expectedState) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "steam_state_invalid"))
    }

    const isValid = await verifySteamAssertion(url.searchParams)
    if (!isValid) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "steam_verification_failed"))
    }

    const steamId = extractSteamId(url.searchParams.get("openid.claimed_id"))
    if (!steamId) {
      return NextResponse.redirect(buildRedirect(url, nextPath, "steam_missing_id"))
    }

    const steamProfile = await fetchSteamProfile(steamId)

    const { error } = await supabase
      .from("user_connections")
      .upsert({
        user_id: user.id,
        provider: "steam",
        provider_user_id: steamId,
        username: steamProfile.displayName || steamId,
        display_name: steamProfile.displayName || `Steam #${steamId}`,
        profile_url: `https://steamcommunity.com/profiles/${steamId}`,
        metadata: {
          linked_via: "openid",
          ...(steamProfile.gameCount !== null ? { game_count: steamProfile.gameCount } : {}),
          ...(steamProfile.avatarUrl ? { avatar_url: steamProfile.avatarUrl } : {}),
        },
      }, { onConflict: "user_id,provider" })

    const status = !error ? "steam_linked" : isUserConnectionsTableMissing(error) ? "connections_storage_unavailable" : "steam_save_failed"
    const response = NextResponse.redirect(buildRedirect(url, nextPath, status))
    response.cookies.delete("steam_oauth_state")
    return response
  } catch (err) {
    console.error("Steam callback error", { route: "GET /api/users/connections/steam/callback", error: err instanceof Error ? err.message : String(err) })
    const response = NextResponse.redirect(buildRedirect(url, nextPath, "steam_error"))
    response.cookies.delete("steam_oauth_state")
    return response
  }
}
