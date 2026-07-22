import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isValidDmThemePreset } from "@/lib/dm-theme"

/**
 * GET /api/dm/channels/[channelId]/theme
 *
 * Returns the conversation-level theme preset for a DM/group channel
 * (null when no override has been set). Membership-checked.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: membership, error: membershipError } = await supabase
      .from("dm_channel_members")
      .select("user_id")
      .eq("dm_channel_id", channelId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) {
      console.error("[dm/channels/[channelId]/theme][GET] membership check failed", { channelId, userId: user.id, error: membershipError.message })
      return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: channel, error: channelError } = await supabase
      .from("dm_channels")
      .select("theme_preset")
      .eq("id", channelId)
      .maybeSingle()

    if (channelError) {
      console.error("[dm/channels/[channelId]/theme][GET] fetch failed", { channelId, userId: user.id, error: channelError.message })
      return NextResponse.json({ error: "Failed to fetch conversation theme" }, { status: 500 })
    }
    if (!channel) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    return NextResponse.json({ theme_preset: channel.theme_preset ?? null })
  } catch (err) {
    console.error("[dm/channels/[channelId]/theme][GET] unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH /api/dm/channels/[channelId]/theme
 *
 * Sets (or clears, with theme_preset: null) the conversation-level theme
 * preset. Any member of the conversation may set it — it's a shared cosmetic
 * preference, not an ownership-gated setting. Membership + value are both
 * re-validated server-side inside the `set_dm_channel_theme` RPC.
 *
 * Body: { theme_preset: string | null }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
): Promise<NextResponse> {
  try {
    const { channelId } = await params
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    if (!body || typeof body !== "object" || !("theme_preset" in body)) {
      return NextResponse.json({ error: "theme_preset is required (string or null)" }, { status: 400 })
    }

    const themePreset = (body as { theme_preset: unknown }).theme_preset
    if (!isValidDmThemePreset(themePreset)) {
      return NextResponse.json({ error: "Invalid theme_preset value" }, { status: 400 })
    }

    // Membership is re-checked inside the RPC (SECURITY DEFINER), which is
    // also the only path allowed to write this column — see migration 00105.
    const { error: rpcError } = await supabase.rpc("set_dm_channel_theme", {
      p_dm_channel_id: channelId,
      p_theme_preset: themePreset,
    })

    if (rpcError) {
      const message = rpcError.message ?? ""
      if (message.includes("not a member")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      if (message.includes("invalid theme_preset")) {
        return NextResponse.json({ error: "Invalid theme_preset value" }, { status: 400 })
      }
      console.error("[dm/channels/[channelId]/theme][PATCH] rpc failed", { channelId, userId: user.id, error: message })
      return NextResponse.json({ error: "Failed to update conversation theme" }, { status: 500 })
    }

    return NextResponse.json({ theme_preset: themePreset })
  } catch (err) {
    console.error("[dm/channels/[channelId]/theme][PATCH] unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
