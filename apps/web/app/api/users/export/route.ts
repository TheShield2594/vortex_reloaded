import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * GET /api/users/export
 *
 * GDPR data export — returns a JSON file containing all user-owned data:
 * profile, messages, DMs, friend list, server memberships, notification preferences.
 *
 * Rate limited: one export per 24 hours via client-side gating + server check.
 */
export async function GET() {
  try {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = user.id

  // Rate limit: one export per 24 hours
  const { rateLimiter } = await import("@/lib/rate-limit")
  const rl = await rateLimiter.check(`export:${userId}`, { limit: 1, windowMs: 24 * 60 * 60 * 1000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Export rate limit exceeded. Please try again in 24 hours." },
      { status: 429 }
    )
  }

  // Gather all user-owned data in parallel
  const [
    profileResult,
    messagesResult,
    dmMessagesResult,
    friendsResult,
    serversResult,
    notifPrefsResult,
    reactionsResult,
  ] = await Promise.all([
    // Profile
    supabase
      .from("users")
      .select("id, username, display_name, bio, avatar_url, banner_color, status, status_message, status_emoji, custom_tag, onboarding_completed_at, created_at")
      .eq("id", userId)
      .single(),
    // Server messages (last 10k for practical limits)
    supabase
      .from("messages")
      .select("id, channel_id, content, created_at, edited_at, deleted_at")
      .eq("author_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10000),
    // DM messages (last 10k)
    supabase
      .from("direct_messages")
      .select("id, dm_channel_id, content, created_at")
      .eq("sender_id", userId)
      .order("created_at", { ascending: false })
      .limit(10000),
    // Friends
    supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status, created_at")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    // Server memberships
    supabase
      .from("server_members")
      .select("server_id, joined_at, servers(name)")
      .eq("user_id", userId),
    // Notification preferences
    supabase
      .from("user_notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    // Reactions
    supabase
      .from("reactions")
      .select("id, message_id, emoji, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5000),
  ])

  // Check for query errors
  const queryErrors = [
    profileResult.error && `profile: ${profileResult.error.message}`,
    messagesResult.error && `messages: ${messagesResult.error.message}`,
    dmMessagesResult.error && `direct_messages: ${dmMessagesResult.error.message}`,
    friendsResult.error && `friendships: ${friendsResult.error.message}`,
    serversResult.error && `server_memberships: ${serversResult.error.message}`,
    notifPrefsResult.error && `notification_preferences: ${notifPrefsResult.error.message}`,
    reactionsResult.error && `reactions: ${reactionsResult.error.message}`,
  ].filter(Boolean)

  if (queryErrors.length > 0) {
    return NextResponse.json(
      { error: "Failed to gather export data" },
      { status: 500 }
    )
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile: profileResult.data ?? null,
    messages: {
      count: messagesResult.data?.length ?? 0,
      items: messagesResult.data ?? [],
    },
    direct_messages: {
      count: dmMessagesResult.data?.length ?? 0,
      items: dmMessagesResult.data ?? [],
    },
    friendships: friendsResult.data ?? [],
    server_memberships: serversResult.data ?? [],
    notification_preferences: notifPrefsResult.data ?? null,
    reactions: {
      count: reactionsResult.data?.length ?? 0,
      items: reactionsResult.data ?? [],
    },
  }

  const body = JSON.stringify(exportData, null, 2)

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="vortexchat-export-${userId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
