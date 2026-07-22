import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"

type Params = { params: Promise<{ serverId: string }> }

/**
 * GET /api/servers/[serverId]/apps/giveaway
 * Returns giveaway config + active giveaways for the server.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerPermission(serverId, "SEND_MESSAGES")
    if (error) return error

    const [configResult, giveawaysResult] = await Promise.all([
      supabase
        .from("giveaway_app_configs")
        .select("*")
        .eq("server_id", serverId)
        .maybeSingle(),
      supabase
        .from("giveaways")
        .select("*, giveaway_entries(count)")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(50),
    ])

    if (configResult.error) return NextResponse.json({ error: "Failed to fetch giveaway configuration" }, { status: 500 })

    return NextResponse.json({
      config: configResult.data,
      giveaways: giveawaysResult.data ?? [],
    })

  } catch (err) {
    console.error("[servers/[serverId]/apps/giveaway GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/apps/giveaway
 * Create a new giveaway or update giveaway config.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
  const { serverId } = await params
  const { supabase, user, error } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
  if (error) return error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const action = body.action as string

  // Update giveaway channel config
  if (action === "set_channel") {
    const channelId = body.channel_id as string | null

    if (channelId) {
      const { data: channel } = await supabase
        .from("channels")
        .select("id")
        .eq("id", channelId)
        .eq("server_id", serverId)
        .single()
      if (!channel) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
    }

    const { data, error: upsertError } = await supabase
      .from("giveaway_app_configs")
      .upsert({ server_id: serverId, channel_id: channelId, enabled: true }, { onConflict: "server_id" })
      .select("*")
      .single()

    if (upsertError) return NextResponse.json({ error: "Failed to update giveaway configuration" }, { status: 500 })
    return NextResponse.json(data)
  }

  // Create a new giveaway
  if (action === "create_giveaway") {
    const { title, description, prize, winners_count, duration_minutes, channel_id } = body as {
      title?: string
      description?: string
      prize?: string
      winners_count?: number
      duration_minutes?: number
      channel_id?: string
    }

    if (!prize) return NextResponse.json({ error: "prize is required" }, { status: 400 })
    if (!duration_minutes || duration_minutes < 1 || duration_minutes > 43200) {
      return NextResponse.json({ error: "duration_minutes must be between 1 and 43200 (30 days)" }, { status: 400 })
    }

    // Determine channel — use explicit channel_id or fall back to configured giveaway channel
    let targetChannelId = channel_id

    // Validate explicit channel_id belongs to this server
    if (targetChannelId) {
      const { data: ch, error: channelError } = await supabase.from("channels").select("id").eq("id", targetChannelId).eq("server_id", serverId).maybeSingle()
      if (channelError) return NextResponse.json({ error: "Failed to validate channel" }, { status: 500 })
      if (!ch) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
    }

    if (!targetChannelId) {
      const { data: config } = await supabase
        .from("giveaway_app_configs")
        .select("channel_id")
        .eq("server_id", serverId)
        .maybeSingle()
      targetChannelId = config?.channel_id ?? undefined
    }

    if (!targetChannelId) {
      return NextResponse.json({ error: "No giveaway channel configured. Set one first." }, { status: 400 })
    }

    const endsAt = new Date(Date.now() + duration_minutes * 60 * 1000).toISOString()
    const giveawayTitle = title || prize

    const { data: giveaway, error: insertError } = await supabase
      .from("giveaways")
      .insert({
        server_id: serverId,
        channel_id: targetChannelId,
        title: giveawayTitle,
        description: description || null,
        prize,
        winners_count: Math.min(Math.max(winners_count ?? 1, 1), 20),
        ends_at: endsAt,
        created_by: user!.id,
      })
      .select("*")
      .single()

    if (insertError) return NextResponse.json({ error: "Failed to create giveaway" }, { status: 500 })

    // Post announcement message in the giveaway channel
    const serviceClient = await createServiceRoleClient()
    const announceContent = [
      `🎉 **GIVEAWAY** 🎉`,
      ``,
      `**${giveawayTitle}**`,
      description || "",
      ``,
      `🎁 Prize: **${prize}**`,
      `👥 Winners: **${giveaway.winners_count}**`,
      `⏰ Ends: <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>`,
      ``,
      `React with 🎉 to enter!`,
    ].filter(Boolean).join("\n")

    const { data: announceMsg, error: announceError } = await serviceClient.from("messages").insert({
      channel_id: targetChannelId,
      author_id: SYSTEM_BOT_ID,
      content: announceContent,
      webhook_display_name: "Giveaway Bot",
    }).select("id").single()

    if (announceError || !announceMsg) {
      // Rollback: delete the giveaway we just created
      const { error: rollbackError } = await supabase.from("giveaways").delete().eq("id", giveaway.id)
      if (rollbackError) {
        console.error("[servers/[serverId]/apps/giveaway POST] rollback failed", {
          serverId,
          giveawayId: giveaway.id,
          error: rollbackError.message,
        })
      }
      return NextResponse.json({ error: "Failed to post giveaway announcement" }, { status: 500 })
    }

    // Store the announcement message ID on the giveaway for reaction-based entry
    const { error: linkError } = await serviceClient.from("giveaways")
      .update({ message_id: announceMsg.id })
      .eq("id", giveaway.id)

    if (linkError) {
      console.error("[giveaway POST] Failed to link message_id", {
        serverId,
        giveawayId: giveaway.id,
        messageId: announceMsg.id,
        error: linkError.message,
      })
    }

    // Seed a 🎉 reaction on the announcement so users know to react
    const { error: seedError } = await serviceClient.from("reactions")
      .insert({ message_id: announceMsg.id, user_id: SYSTEM_BOT_ID, emoji: "🎉" })

    if (seedError) {
      console.error("[giveaway POST] Failed to seed reaction", {
        serverId,
        giveawayId: giveaway.id,
        messageId: announceMsg.id,
        error: seedError.message,
      })
    }

    return NextResponse.json(giveaway, { status: 201 })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[servers/[serverId]/apps/giveaway POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
