import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb, dmChannelMembers, dmChannels } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"
import { isValidDmThemePreset } from "@/lib/dm-theme"

const db = createDb()

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

    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let membership: { userId: string } | undefined
    try {
      const rows = await db
        .select({ userId: dmChannelMembers.userId })
        .from(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
        .limit(1)
      membership = rows[0]
    } catch (err) {
      console.error("[dm/channels/[channelId]/theme][GET] membership check failed", { channelId, userId: user.id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let channel: { themePreset: string | null } | undefined
    try {
      const rows = await db
        .select({ themePreset: dmChannels.themePreset })
        .from(dmChannels)
        .where(eq(dmChannels.id, channelId))
        .limit(1)
      channel = rows[0]
    } catch (err) {
      console.error("[dm/channels/[channelId]/theme][GET] fetch failed", { channelId, userId: user.id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to fetch conversation theme" }, { status: 500 })
    }
    if (!channel) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    return NextResponse.json({ theme_preset: channel.themePreset ?? null })
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
 * preference, not an ownership-gated setting.
 *
 * Membership + value were previously re-validated inside the Postgres
 * `set_dm_channel_theme` SECURITY DEFINER RPC (see migration 00105); SQLite
 * has no RLS/RPC layer, so both checks are now done explicitly here before
 * the write, preserving the exact same authorization behavior.
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

    const { data: { user }, error: authError } = await getBetterAuthUser()
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

    // Membership check — mirrors the `not a member of this conversation`
    // guard that used to live inside `set_dm_channel_theme`.
    let membership: { userId: string } | undefined
    try {
      const rows = await db
        .select({ userId: dmChannelMembers.userId })
        .from(dmChannelMembers)
        .where(and(eq(dmChannelMembers.dmChannelId, channelId), eq(dmChannelMembers.userId, user.id)))
        .limit(1)
      membership = rows[0]
    } catch (err) {
      console.error("[dm/channels/[channelId]/theme][PATCH] membership check failed", { channelId, userId: user.id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to update conversation theme" }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    try {
      await db.update(dmChannels).set({ themePreset }).where(eq(dmChannels.id, channelId))
    } catch (err) {
      console.error("[dm/channels/[channelId]/theme][PATCH] update failed", { channelId, userId: user.id, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: "Failed to update conversation theme" }, { status: 500 })
    }

    return NextResponse.json({ theme_preset: themePreset })
  } catch (err) {
    console.error("[dm/channels/[channelId]/theme][PATCH] unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
