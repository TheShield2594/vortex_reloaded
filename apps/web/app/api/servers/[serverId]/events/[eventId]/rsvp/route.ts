import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"

type RsvpStatus = "interested" | "going" | "maybe" | "not_going" | "waitlist"

export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string; eventId: string }> }
) {
  const params = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Verify membership
  const { data: member, error: memberError } = await supabase
    .from("server_members")
    .select("server_id")
    .eq("server_id", params.serverId)
    .eq("user_id", user.id)
    .single()
  if (memberError && memberError.code !== "PGRST116") {
    return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 })
  }
  if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null || !("status" in body) || typeof (body as Record<string, unknown>).status !== "string") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const validStatuses: RsvpStatus[] = ["interested", "going", "maybe", "not_going", "waitlist"]
  const rawStatus = (body as Record<string, unknown>).status as string
  if (!validStatuses.includes(rawStatus as RsvpStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }
  const requestedStatus = rawStatus as RsvpStatus

  // Fetch event for capacity check
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, capacity")
    .eq("id", params.eventId)
    .eq("server_id", params.serverId)
    .single()
  if (eventError && eventError.code !== "PGRST116") {
    return NextResponse.json({ error: "Failed to fetch event" }, { status: 500 })
  }
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  let resolvedStatus: RsvpStatus = requestedStatus

  // Fetch the user's current RSVP (if any) before making changes
  const { data: currentRsvp, error: rsvpFetchError } = await supabase
    .from("event_rsvps")
    .select("status")
    .eq("event_id", params.eventId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (rsvpFetchError) {
    return NextResponse.json({ error: "Failed to fetch current RSVP" }, { status: 500 })
  }
  const previousStatus: RsvpStatus | null = currentRsvp
    ? (currentRsvp.status as RsvpStatus)
    : null

  // If going and capacity is set, check if at capacity
  if (requestedStatus === "going" && event.capacity) {
    const { count } = await supabase
      .from("event_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("event_id", params.eventId)
      .eq("status", "going")
      .neq("user_id", user.id)

    if ((count ?? 0) >= event.capacity) {
      resolvedStatus = "waitlist"
    }
  }

  const { error } = await supabase
    .from("event_rsvps")
    .upsert(
      { event_id: params.eventId, user_id: user.id, status: resolvedStatus },
      { onConflict: "event_id,user_id" }
    )

  if (error) return NextResponse.json({ error: "Failed to update RSVP" }, { status: 500 })

  // Auto-promote from waitlist only when someone leaves the "going" status.
  // Promotion is non-fatal — the RSVP change already committed successfully.
  // Uses service-role client since promote_from_waitlist is restricted to service_role.
  if (previousStatus === "going" && requestedStatus !== "going" && event.capacity) {
    try {
      const service = await createServiceRoleClient()
      const { error: promoteError } = await service.rpc("promote_from_waitlist", {
        p_event_id: params.eventId,
      })
      if (promoteError) {
        console.error("promote_from_waitlist failed (non-fatal)", {
          route: "POST /events/[eventId]/rsvp",
          eventId: params.eventId,
          userId: user.id,
          previousStatus,
          requestedStatus,
          error: promoteError.message,
        })
      }
    } catch (err) {
      console.error("promote_from_waitlist threw (non-fatal)", {
        route: "POST /events/[eventId]/rsvp",
        eventId: params.eventId,
        userId: user.id,
        previousStatus,
        requestedStatus,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ status: resolvedStatus })
}
