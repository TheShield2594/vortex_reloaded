import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { sendPushToUser } from "@/lib/push"
import { publishGatewayEvent } from "@/lib/gateway-publish"
import type { MessageWithChannelServerId } from "@/types/database"

interface Body {
  emoji?: string
  nonce?: string
}

async function resolveMessageContext(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, messageId: string) {
  return supabase
    .from("messages")
    .select("id, author_id, channel_id, channels(server_id)")
    .eq("id", messageId)
    .is("deleted_at", null)
    .maybeSingle()
}

function normalizeEmoji(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  return value.slice(0, 64)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }): Promise<NextResponse> {
  try {
    const { messageId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const emoji = normalizeEmoji(body.emoji)
    if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 })

    const { data: message, error: messageError } = await resolveMessageContext(supabase, messageId)
    if (messageError) return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 })
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const typedMessage = message as unknown as MessageWithChannelServerId
    const channelServerId = typedMessage.channels?.server_id ?? null
    if (channelServerId) {
      const { isAdmin, permissions } = await getChannelPermissions(supabase, channelServerId, message.channel_id, user.id)
      if (!isAdmin && !hasPermission(permissions, "VIEW_CHANNELS")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    if (await isBlockedBetweenUsers(supabase, user.id, message.author_id)) {
      return NextResponse.json({ error: "Cannot react due to block state" }, { status: 403 })
    }

    const { error } = await supabase
      .from("reactions")
      .upsert({ message_id: messageId, user_id: user.id, emoji }, { onConflict: "message_id,user_id,emoji", ignoreDuplicates: true })

    if (error) return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 })

    // Auto-enter giveaway when reacting with 🎉 on a giveaway announcement (fire-and-forget)
    if (emoji === "🎉") {
      ;(async () => {
        const { data: giveaway } = await supabase
          .from("giveaways")
          .select("id, status, ends_at")
          .eq("message_id", messageId)
          .eq("status", "active")
          .maybeSingle()

        if (giveaway && new Date(giveaway.ends_at) > new Date()) {
          await supabase
            .from("giveaway_entries")
            .upsert(
              { giveaway_id: giveaway.id, user_id: user.id },
              { onConflict: "giveaway_id,user_id", ignoreDuplicates: true }
            )
        }
      })().catch((err: unknown) => { console.error("Giveaway auto-enter failed", err) })
    }

    // Notify the message author about the reaction (fire-and-forget)
    if (message.author_id && message.author_id !== user.id) {
      const { data: reactor } = await supabase
        .from("users")
        .select("display_name, username")
        .eq("id", user.id)
        .maybeSingle()
      const reactorName = reactor?.display_name || reactor?.username || "Someone"
      await sendPushToUser(message.author_id, {
        title: `${reactorName} reacted ${emoji}`,
        body: "to your message",
        url: channelServerId
          ? `/channels/${channelServerId}/${message.channel_id}`
          : "/channels/me",
        tag: `reaction-${messageId}`,
      }).catch((err) => { console.error("Failed to send reaction push", err) })
    }

    // Publish to gateway for real-time delivery (#696)
    publishGatewayEvent({
      type: "reaction.added",
      channelId: message.channel_id,
      serverId: channelServerId,
      actorId: user.id,
      data: { message_id: messageId, user_id: user.id, emoji },
    }).catch((err: unknown) => {
      console.error("[reactions POST] gateway publish failed", { route: "/api/messages/[messageId]/reactions", action: "reaction.added", userId: user.id, messageId, channelId: message.channel_id, error: err instanceof Error ? err.message : String(err) })
    })

    return NextResponse.json({ ok: true, emoji, nonce: body.nonce ?? null })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }): Promise<NextResponse> {
  try {
    const { messageId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const emoji = normalizeEmoji(body.emoji)
    if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 })

    const { data: message, error: messageError } = await resolveMessageContext(supabase, messageId)
    if (messageError) return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 })
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const typedMessage = message as unknown as MessageWithChannelServerId
    const channelServerId = typedMessage.channels?.server_id ?? null
    if (channelServerId) {
      const { isAdmin, permissions } = await getChannelPermissions(supabase, channelServerId, message.channel_id, user.id)
      if (!isAdmin && !hasPermission(permissions, "VIEW_CHANNELS")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", user.id)
      .eq("emoji", emoji)

    if (error) return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 })

    // Auto-leave giveaway when removing 🎉 reaction (fire-and-forget)
    if (emoji === "🎉") {
      ;(async () => {
        const { data: giveaway } = await supabase
          .from("giveaways")
          .select("id, status, ends_at")
          .eq("message_id", messageId)
          .eq("status", "active")
          .maybeSingle()

        if (giveaway && new Date(giveaway.ends_at) > new Date()) {
          await supabase
            .from("giveaway_entries")
            .delete()
            .eq("giveaway_id", giveaway.id)
            .eq("user_id", user.id)
        }
      })().catch((err: unknown) => { console.error("Giveaway auto-leave failed", err) })
    }

    // Publish to gateway for real-time delivery (#696)
    publishGatewayEvent({
      type: "reaction.removed",
      channelId: message.channel_id,
      serverId: channelServerId,
      actorId: user.id,
      data: { message_id: messageId, user_id: user.id, emoji },
    }).catch((err: unknown) => {
      console.error("[reactions DELETE] gateway publish failed", { route: "/api/messages/[messageId]/reactions", action: "reaction.removed", userId: user.id, messageId, channelId: message.channel_id, error: err instanceof Error ? err.message : String(err) })
    })

    return NextResponse.json({ ok: true, emoji, nonce: body.nonce ?? null })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
