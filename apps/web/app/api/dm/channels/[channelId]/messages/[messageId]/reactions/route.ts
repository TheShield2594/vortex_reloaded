import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isBlockedBetweenUsers } from "@/lib/blocking"
import { untypedFrom } from "@/lib/supabase/untyped-table"

interface Body {
  emoji?: string
  nonce?: string
}

function normalizeEmoji(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  return value.slice(0, 64)
}

async function verifyMembershipAndMessage(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  channelId: string,
  messageId: string,
  userId: string
): Promise<{ error: NextResponse | null; message: { id: string; sender_id: string } | null }> {
  // Verify the user is a member of this DM channel
  const { data: membership, error: membershipError } = await supabase
    .from("dm_channel_members")
    .select("user_id")
    .eq("dm_channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle()

  if (membershipError) return { error: NextResponse.json({ error: "Failed to verify membership" }, { status: 500 }), message: null }
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), message: null }

  // Verify the message exists in this channel
  const { data: message, error: messageError } = await supabase
    .from("direct_messages")
    .select("id, sender_id")
    .eq("id", messageId)
    .eq("dm_channel_id", channelId)
    .is("deleted_at", null)
    .maybeSingle()

  if (messageError) return { error: NextResponse.json({ error: "Failed to fetch message" }, { status: 500 }), message: null }
  if (!message) return { error: NextResponse.json({ error: "Message not found" }, { status: 404 }), message: null }

  return { error: null, message }
}

// POST — add a reaction to a DM message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId, messageId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const emoji = normalizeEmoji(body.emoji)
    if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 })

    const { error: verifyError, message } = await verifyMembershipAndMessage(supabase, channelId, messageId, user.id)
    if (verifyError) return verifyError
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    if (await isBlockedBetweenUsers(supabase, user.id, message.sender_id)) {
      return NextResponse.json({ error: "Cannot react due to block state" }, { status: 403 })
    }

    const { error } = await untypedFrom(supabase, "dm_reactions")
      .upsert(
        { dm_id: messageId, user_id: user.id, emoji },
        { onConflict: "dm_id,user_id,emoji", ignoreDuplicates: true }
      )

    if (error) {
      console.error("[dm reactions POST] upsert error:", { messageId, userId: user.id, emoji, code: error.code, message: error.message })
      return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, emoji, nonce: body.nonce ?? null })
  } catch (err) {
    console.error("[dm reactions POST] error:", { action: "createReaction", error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE — remove a reaction from a DM message
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId, messageId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const emoji = normalizeEmoji(body.emoji)
    if (!emoji) return NextResponse.json({ error: "emoji required" }, { status: 400 })

    const { error: verifyError } = await verifyMembershipAndMessage(supabase, channelId, messageId, user.id)
    if (verifyError) return verifyError

    const { error } = await untypedFrom(supabase, "dm_reactions")
      .delete()
      .eq("dm_id", messageId)
      .eq("user_id", user.id)
      .eq("emoji", emoji)

    if (error) {
      console.error("[dm reactions DELETE] delete error:", { messageId, userId: user.id, emoji, code: error.code, message: error.message })
      return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, emoji, nonce: body.nonce ?? null })
  } catch (err) {
    console.error("[dm reactions DELETE] error:", { action: "deleteReaction", error: err })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
