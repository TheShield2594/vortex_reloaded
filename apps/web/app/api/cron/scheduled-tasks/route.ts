import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { verifyBearerToken } from "@/lib/utils/timing-safe"

/**
 * Unified cron dispatcher — runs all periodic tasks in a single Vercel cron
 * slot.  Individual task routes (/api/cron/event-reminders, etc.) remain
 * available for manual or test invocations.
 *
 * Schedule: daily at midnight UTC via Vercel cron (see vercel.json).
 */
export async function GET(request: Request) {
  try {
    // Fail closed: require CRON_SECRET to be configured
    if (!process.env.CRON_SECRET) {
      console.error("[scheduled-tasks] CRON_SECRET is not configured")
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const authHeader = request.headers.get("authorization")
    if (!verifyBearerToken(authHeader, process.env.CRON_SECRET!)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const service = await createServiceRoleClient()

    // Run all tasks concurrently — each is independent.
    const [eventReminders, threadAutoArchive, attachmentDecay] = await Promise.allSettled([
      runEventReminders(service),
      runThreadAutoArchive(service),
      runAttachmentDecay(request),
    ])

    return NextResponse.json({
      eventReminders: eventReminders.status === "fulfilled" ? eventReminders.value : { error: (eventReminders as PromiseRejectedResult).reason?.message },
      threadAutoArchive: threadAutoArchive.status === "fulfilled" ? threadAutoArchive.value : { error: (threadAutoArchive as PromiseRejectedResult).reason?.message },
      attachmentDecay: attachmentDecay.status === "fulfilled" ? attachmentDecay.value : { error: (attachmentDecay as PromiseRejectedResult).reason?.message },
    })
  } catch (err) {
    console.error("[cron/scheduled-tasks GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── Event reminders ──────────────────────────────────────────────────────────
async function runEventReminders(service: Awaited<ReturnType<typeof createServiceRoleClient>>) {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000) // next 24 hours

  const { data: events, error: eventsError } = await service
    .from("events")
    .select("id, title, server_id, linked_channel_id, start_at")
    .gte("start_at", now.toISOString())
    .lte("start_at", windowEnd.toISOString())

  if (eventsError) {
    console.error("[event-reminders] Failed to fetch events:", eventsError.message)
    return { notified: 0, error: eventsError.message }
  }

  if (!events || events.length === 0) {
    return { notified: 0 }
  }

  let totalNotified = 0

  for (const event of events) {
    const { data: rsvps } = await service
      .from("event_rsvps")
      .select("user_id")
      .eq("event_id", event.id)
      .in("status", ["going", "maybe"])

    if (!rsvps || rsvps.length === 0) continue

    const notifications = rsvps.map((r: { user_id: string }) => ({
      user_id: r.user_id,
      type: "system" as const,
      title: `\u23F0 Event today: ${event.title}`,
      body: `${event.title} is happening today at ${new Date(event.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`,
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
  }

  return { notified: totalNotified, eventsProcessed: events.length }
}

// ── Thread auto-archive ──────────────────────────────────────────────────────
async function runThreadAutoArchive(service: Awaited<ReturnType<typeof createServiceRoleClient>>) {
  const { data, error } = await service.rpc("auto_archive_inactive_threads")

  if (error) {
    console.error("[thread-auto-archive] RPC failed:", error.message)
    return { archived: 0, error: error.message }
  }

  const archivedCount = typeof data === "number" ? data : 0

  if (archivedCount > 0) {
    console.info(`[thread-auto-archive] Archived ${archivedCount} inactive thread(s)`)
  }

  return { archived: archivedCount }
}

// ── Attachment decay (delegated to existing route) ──────────────────────────
async function runAttachmentDecay(request: Request): Promise<Record<string, unknown>> {
  const { GET: attachmentDecayHandler } = await import("@/app/api/cron/attachment-decay/route")
  const forwardedRequest = new NextRequest(request.url, {
    method: "GET",
    headers: request.headers,
  })
  const res = await attachmentDecayHandler(forwardedRequest)
  return await res.json() as Record<string, unknown>
}
