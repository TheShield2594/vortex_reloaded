import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { sendPushToUser } from "@/lib/push"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

/**
 * Notify RSVP'd members about events starting within 10–20 minutes.
 * Now invoked by /api/cron/scheduled-tasks dispatcher; kept for manual use.
 */
export async function GET(request: Request) {
  try {
    // Fail closed: require CRON_SECRET to be configured
    const secret = process.env.CRON_SECRET
    if (!secret) {
      console.error("[event-reminders] CRON_SECRET is not configured")
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }
    const authHeader = request.headers.get("authorization")
    if (!verifyBearerToken(authHeader, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const service = await createServiceRoleClient()

    const now = new Date()
    const windowStart = new Date(now.getTime() + 10 * 60 * 1000)  // 10 min from now
    const windowEnd = new Date(now.getTime() + 20 * 60 * 1000)    // 20 min from now

    // Find events starting within the 10–20 min window
    const { data: events, error: eventsError } = await service
      .from("events")
      .select("id, title, server_id, linked_channel_id, start_at")
      .gte("start_at", windowStart.toISOString())
      .lte("start_at", windowEnd.toISOString())

    if (eventsError) {
      console.error("[event-reminders] Failed to fetch events:", eventsError.message)
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 })
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ notified: 0 })
    }

    let totalNotified = 0

    for (const event of events) {
      // Get users who RSVP'd going or maybe
      const { data: rsvps } = await service
        .from("event_rsvps")
        .select("user_id")
        .eq("event_id", event.id)
        .in("status", ["going", "maybe"])

      if (!rsvps || rsvps.length === 0) continue

      const notifications = rsvps.map((r: { user_id: string }) => ({
        user_id: r.user_id,
        type: "system" as const,
        title: `\u23F0 Starting soon: ${event.title}`,
        body: `${event.title} starts in about 15 minutes.`,
        server_id: event.server_id,
        channel_id: event.linked_channel_id ?? null,
      }))

      const { error: notifError } = await service
        .from("notifications")
        .insert(notifications)

      if (notifError) {
        console.error(`[event-reminders] Failed to insert notifications for event ${event.id}:`, notifError.message)
      } else {
        totalNotified += notifications.length
      }

      // Push notifications for RSVP'd members
      await Promise.allSettled(
        rsvps.map((r: { user_id: string }) =>
          sendPushToUser(r.user_id, {
            title: `⏰ Starting soon: ${event.title}`,
            body: `${event.title} starts in about 15 minutes.`,
            url: `/channels/${event.server_id}`,
            tag: `event-reminder-${event.id}`,
          })
        )
      )
    }

    return NextResponse.json({ notified: totalNotified, eventsProcessed: events.length })

  } catch (err) {
    console.error("[cron/event-reminders GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
