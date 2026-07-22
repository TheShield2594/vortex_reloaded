import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { sendPushToUser } from "@/lib/push"
import { rateLimiter } from "@/lib/rate-limit"

/**
 * POST /api/notifications/test
 *
 * Sends a test push notification to the current user, bypassing quiet hours.
 * Rate limited to 1 request per 30 seconds per user (#609).
 */
export async function POST(): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Rate limit: 1 test per 30 seconds
    const { allowed } = await rateLimiter.check(`notif-test:${user.id}`, {
      limit: 1,
      windowMs: 30_000,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: "Please wait 30 seconds before sending another test notification" },
        { status: 429 }
      )
    }

    // Check if the user has any push subscriptions
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)

    if (!subs?.length) {
      return NextResponse.json(
        { error: "No push subscription found. Please enable notifications first." },
        { status: 400 }
      )
    }

    // Send a real test push through the full pipeline, bypassing quiet hours
    await sendPushToUser(
      user.id,
      {
        title: "VortexChat ��� Test Notification",
        body: "This is a test notification. If you see this, push notifications are working!",
        url: "/channels/me",
        tag: "test-notification",
        icon: "/icon-192.png",
      },
      { skipQuietHours: true }
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("notifications/test: unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
