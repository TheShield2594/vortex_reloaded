import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"

type Params = { params: Promise<{ serverId: string; giveawayId: string }> }

/**
 * POST /api/servers/[serverId]/apps/giveaway/[giveawayId]
 * Actions: enter, leave, end, cancel, reroll
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
  const { serverId, giveawayId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { action } = body

  // Resolve giveaway — support both full UUID and short prefix
  let giveaway: Record<string, unknown> | null = null
  const { data: exactMatch } = await supabase
    .from("giveaways")
    .select("*")
    .eq("id", giveawayId)
    .eq("server_id", serverId)
    .maybeSingle()

  if (exactMatch) {
    giveaway = exactMatch
  } else {
    // Try prefix match (for slash command short IDs)
    const { data: prefixMatches } = await supabase
      .from("giveaways")
      .select("*")
      .eq("server_id", serverId)
      .like("id", `${giveawayId}%`)
      .limit(2)

    if (prefixMatches && prefixMatches.length === 1) {
      giveaway = prefixMatches[0]
    }
  }

  if (!giveaway) return NextResponse.json({ error: "Giveaway not found" }, { status: 404 })

  const giveawayRecord = giveaway as {
    id: string
    server_id: string
    channel_id: string
    title: string
    prize: string
    winners_count: number
    status: string
    ends_at: string
    winner_ids: string[]
  }

  // Enter giveaway
  if (action === "enter") {
    if (giveawayRecord.status !== "active") {
      return NextResponse.json({ error: "This giveaway is no longer active" }, { status: 400 })
    }
    if (new Date(giveawayRecord.ends_at) < new Date()) {
      return NextResponse.json({ error: "This giveaway has ended" }, { status: 400 })
    }

    const { error: entryError } = await supabase
      .from("giveaway_entries")
      .insert({ giveaway_id: giveawayRecord.id, user_id: user.id })

    if (entryError) {
      if (entryError.code === "23505") {
        return NextResponse.json({ error: "You already entered this giveaway" }, { status: 409 })
      }
      return NextResponse.json({ error: entryError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: "You have entered the giveaway!" })
  }

  // Leave giveaway
  if (action === "leave") {
    await supabase
      .from("giveaway_entries")
      .delete()
      .eq("giveaway_id", giveawayRecord.id)
      .eq("user_id", user.id)

    return NextResponse.json({ ok: true, message: "You have left the giveaway" })
  }

  // End / Cancel / Reroll — requires MANAGE_CHANNELS permission
  if (action === "end" || action === "cancel" || action === "reroll") {
    const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
    if (!isAdmin && !hasPermission(permissions, "MANAGE_CHANNELS")) {
      return NextResponse.json({ error: "You need MANAGE_CHANNELS permission" }, { status: 403 })
    }

    if (action === "cancel") {
      const { error: cancelError } = await supabase
        .from("giveaways")
        .update({ status: "cancelled" })
        .eq("id", giveawayRecord.id)
      if (cancelError) return NextResponse.json({ error: cancelError.message }, { status: 500 })

      // Announce cancellation
      const serviceClient = await createServiceRoleClient()
      const { error: msgError } = await serviceClient.from("messages").insert({
        channel_id: giveawayRecord.channel_id,
        author_id: SYSTEM_BOT_ID,
        content: `❌ **GIVEAWAY CANCELLED**\n\nThe giveaway for **${giveawayRecord.prize}** has been cancelled.`,
        webhook_display_name: "Giveaway Bot",
      })
      if (msgError) {
        console.error("[giveaway] Failed to post cancellation message", { serverId, giveawayId: giveawayRecord.id, error: msgError.message })
      }

      return NextResponse.json({ ok: true, message: "Giveaway cancelled" })
    }

    // End or Reroll — draw winners
    if (action === "end" && giveawayRecord.status !== "active") {
      return NextResponse.json({ error: "Giveaway is not active" }, { status: 400 })
    }
    if (action === "reroll" && giveawayRecord.status !== "ended") {
      return NextResponse.json({ error: "Can only reroll ended giveaways" }, { status: 400 })
    }

    // Get all entries
    const { data: entries } = await supabase
      .from("giveaway_entries")
      .select("user_id")
      .eq("giveaway_id", giveawayRecord.id)

    if (!entries || entries.length === 0) {
      // No entries — mark as ended with no winners
      await supabase
        .from("giveaways")
        .update({ status: "ended", winner_ids: [] })
        .eq("id", giveawayRecord.id)

      const serviceClient = await createServiceRoleClient()
      const { error: msgError2 } = await serviceClient.from("messages").insert({
        channel_id: giveawayRecord.channel_id,
        author_id: SYSTEM_BOT_ID,
        content: `🎉 **GIVEAWAY ENDED**\n\nNo one entered the giveaway for **${giveawayRecord.prize}**.`,
        webhook_display_name: "Giveaway Bot",
      })
      if (msgError2) {
        console.error("[giveaway] Failed to post end message", { serverId, giveawayId: giveawayRecord.id, error: msgError2.message })
      }

      return NextResponse.json({ ok: true, message: "Giveaway ended — no entries", winners: [] })
    }

    // Shuffle and pick winners
    const shuffled = entries.map((e: { user_id: string }) => e.user_id).sort(() => Math.random() - 0.5)
    const winnerIds = shuffled.slice(0, giveawayRecord.winners_count)

    await supabase
      .from("giveaways")
      .update({ status: "ended", winner_ids: winnerIds })
      .eq("id", giveawayRecord.id)

    // Fetch winner display names
    const serviceClient = await createServiceRoleClient()
    const { data: winners } = await serviceClient
      .from("users")
      .select("id, display_name, username")
      .in("id", winnerIds)

    const winnerNames = (winners ?? []).map((w: { display_name: string | null; username: string | null }) => w.display_name || w.username || "Unknown").join(", ")
    const verb = action === "reroll" ? "REROLLED" : "ENDED"

    const { error: msgError3 } = await serviceClient.from("messages").insert({
      channel_id: giveawayRecord.channel_id,
      author_id: SYSTEM_BOT_ID,
      content: `🎉 **GIVEAWAY ${verb}** 🎉\n\n🎁 Prize: **${giveawayRecord.prize}**\n🏆 Winner${winnerIds.length > 1 ? "s" : ""}: ${winnerNames}\n\nCongratulations! 🎊`,
      webhook_display_name: "Giveaway Bot",
    })
    if (msgError3) {
      console.error("[giveaway] Failed to post winner message", { serverId, giveawayId: giveawayRecord.id, error: msgError3.message })
    }

    return NextResponse.json({ ok: true, message: `Giveaway ${verb.toLowerCase()}`, winners: winnerIds })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[servers/[serverId]/apps/giveaway/[giveawayId] POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
