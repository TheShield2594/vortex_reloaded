import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { verifyBearerToken } from "@/lib/utils/timing-safe"
import { isGameActivity } from "@vortex/shared"

/**
 * GET /api/cron/game-activity
 *
 * Polls Steam Web API for currently-playing game info for all online users
 * with a Steam connection. Updates the users.game_activity column so the
 * UI can display "Playing <game>" on avatars, chat headers, and profiles.
 *
 * Runs every 2 minutes via Vercel Cron. Protected by CRON_SECRET.
 *
 * #531: Show games users are playing
 */

interface SteamPlayer {
  steamid: string
  gameid?: string
  gameextrainfo?: string
}

interface SteamPlayerSummaryResponse {
  response?: { players?: SteamPlayer[] }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const authHeader = req.headers.get("authorization")
    if (!verifyBearerToken(authHeader, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const apiKey = process.env.STEAM_WEB_API_KEY
    if (!apiKey) {
      return NextResponse.json({ ok: true, skipped: true, reason: "STEAM_WEB_API_KEY not configured" })
    }

    const supabase = await createServiceRoleClient()

    // Find online users with a Steam connection
    const { data: connections, error: connError } = await supabase
      .from("user_connections")
      .select("user_id, provider_user_id")
      .eq("provider", "steam")

    if (connError || !connections || connections.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, reason: connError ? "Query failed" : "No Steam connections" })
    }

    // Only poll for users who are currently online/idle/dnd
    const userIds = connections.map((c) => c.user_id)
    const { data: onlineUsers, error: onlineUsersError } = await supabase
      .from("users")
      .select("id")
      .in("id", userIds)
      .in("status", ["online", "idle", "dnd"])

    if (onlineUsersError) {
      console.error("game-activity: failed to fetch online users", {
        route: "cron/game-activity",
        action: "fetch_online_users",
        error: onlineUsersError.message,
      })
      return NextResponse.json({ error: "Failed to fetch online users" }, { status: 500 })
    }

    if (!onlineUsers || onlineUsers.length === 0) {
      // Clear game_activity for all offline users with stale activity
      await supabase
        .from("users")
        .update({ game_activity: null })
        .in("id", userIds)
        .not("game_activity", "is", null)

      return NextResponse.json({ ok: true, updated: 0, reason: "No online users with Steam" })
    }

    const onlineUserIds = new Set(onlineUsers.map((u) => u.id))
    const onlineConnections = connections.filter((c) => onlineUserIds.has(c.user_id))
    const steamIdToUserId = new Map<string, string>()
    for (const c of onlineConnections) {
      steamIdToUserId.set(c.provider_user_id, c.user_id)
    }

    // Batch Steam IDs into groups of 100 (Steam API limit)
    const steamIds = Array.from(steamIdToUserId.keys())
    const batches: string[][] = []
    for (let i = 0; i < steamIds.length; i += 100) {
      batches.push(steamIds.slice(i, i + 100))
    }

    // Fetch current game_activity to preserve started_at for same game
    const { data: currentActivities } = await supabase
      .from("users")
      .select("id, game_activity")
      .in("id", Array.from(onlineUserIds))

    const currentGameMap = new Map<string, { game_name: string; started_at?: string } | null>()
    for (const u of currentActivities ?? []) {
      currentGameMap.set(u.id, isGameActivity(u.game_activity) ? u.game_activity : null)
    }

    const userGameMap = new Map<string, { game_name: string; game_id: string | null; started_at: string; source: string } | null>()

    for (const batch of batches) {
      try {
        const res = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${batch.join(",")}`,
          { cache: "no-store", signal: AbortSignal.timeout(8000) }
        )
        if (!res.ok) continue

        const data = (await res.json()) as SteamPlayerSummaryResponse
        const players = data?.response?.players ?? []

        for (const player of players) {
          const userId = steamIdToUserId.get(player.steamid)
          if (!userId) continue

          if (player.gameextrainfo) {
            const existing = currentGameMap.get(userId)
            const isSameGame = existing?.game_name === player.gameextrainfo
            userGameMap.set(userId, {
              game_name: player.gameextrainfo,
              game_id: player.gameid ?? null,
              started_at: isSameGame && existing?.started_at ? existing.started_at : new Date().toISOString(),
              source: "steam",
            })
          } else {
            userGameMap.set(userId, null)
          }
        }
      } catch (err) {
        console.error("game-activity: Steam API batch failed", {
          route: "cron/game-activity",
          batchSize: batch.length,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Update game_activity for users (concurrent)
    const updateResults = await Promise.all(
      Array.from(userGameMap.entries()).map(async ([userId, activity]) => {
        const { error: updateError } = await supabase
          .from("users")
          .update({ game_activity: activity })
          .eq("id", userId)
        if (updateError) {
          console.error("game-activity: failed user update", {
            route: "cron/game-activity",
            action: "update_game_activity",
            userId,
            error: updateError.message,
          })
          return 0
        }
        return 1
      })
    )
    const updated = updateResults.reduce<number>((sum, r) => sum + r, 0)

    // Clear game_activity for offline users who still have it set
    const offlineUserIds = userIds.filter((id) => !onlineUserIds.has(id))
    if (offlineUserIds.length > 0) {
      const { error: clearError } = await supabase
        .from("users")
        .update({ game_activity: null })
        .in("id", offlineUserIds)
        .not("game_activity", "is", null)

      if (clearError) {
        console.error("game-activity: failed offline clear", {
          route: "cron/game-activity",
          action: "clear_offline_activity",
          error: clearError.message,
        })
      }
    }

    return NextResponse.json({ ok: true, updated, polled: steamIds.length })
  } catch (err) {
    console.error("game-activity: unexpected error", {
      route: "cron/game-activity",
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
