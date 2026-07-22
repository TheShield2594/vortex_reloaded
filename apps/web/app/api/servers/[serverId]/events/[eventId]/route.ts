import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { untypedFrom } from "@/lib/supabase/untyped-table"
import type { Json } from "@/types/database"

type RouteContext = { params: Promise<{ serverId: string; eventId: string }> }

/**
 * Check if the user can manage this specific event.
 * Allowed when the user is an admin, has MANAGE_EVENTS, or is the event creator.
 */
async function canManageEvent(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  serverId: string,
  eventId: string,
  userId: string
): Promise<{ allowed: boolean; event: Record<string, unknown> | null; isCreator: boolean }> {
  const perms = await getMemberPermissions(supabase, serverId, userId)

  // Admins and users with MANAGE_EVENTS can always manage
  if (perms.isAdmin || hasPermission(perms.permissions, "MANAGE_EVENTS")) {
    const { data: event } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .eq("server_id", serverId)
      .single()
    return { allowed: !!event, event, isCreator: event?.created_by === userId }
  }

  // Otherwise, check if the user is the event creator
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("server_id", serverId)
    .single()

  if (!event) return { allowed: false, event: null, isCreator: false }

  const isCreator = event.created_by === userId
  return { allowed: isCreator, event, isCreator }
}

export async function PATCH(
  request: Request,
  { params: paramsPromise }: RouteContext
) {
  try {
  const params = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const service = await createServiceRoleClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { allowed, event: existing } = await canManageEvent(supabase, params.serverId, params.eventId, user.id)
  if (!allowed) {
    return NextResponse.json({ error: "You don't have permission to edit this event" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = body as {
    title?: unknown; description?: unknown; location?: unknown; linkedChannelId?: unknown;
    startAt?: unknown; endAt?: unknown; timezone?: unknown; recurrence?: unknown;
    recurrenceUntil?: unknown; capacity?: unknown; cancelled?: unknown;
  }

  const updatePayload: Record<string, unknown> = {}
  if (parsed.title !== undefined) updatePayload.title = parsed.title
  if (parsed.description !== undefined) updatePayload.description = parsed.description
  if (parsed.location !== undefined) updatePayload.location = parsed.location
  if (parsed.linkedChannelId !== undefined) updatePayload.linked_channel_id = parsed.linkedChannelId
  if (parsed.startAt !== undefined) updatePayload.start_at = parsed.startAt
  if (parsed.endAt !== undefined) updatePayload.end_at = parsed.endAt
  if (parsed.timezone !== undefined) updatePayload.timezone = parsed.timezone
  if (parsed.recurrence !== undefined) updatePayload.recurrence = parsed.recurrence
  if (parsed.recurrenceUntil !== undefined) updatePayload.recurrence_until = parsed.recurrenceUntil
  if (parsed.capacity !== undefined) updatePayload.capacity = parsed.capacity
  if (parsed.cancelled !== undefined) updatePayload.cancelled_at = parsed.cancelled ? new Date().toISOString() : null

  // Compute the actual diff — only keep fields that differ from the existing event
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const key of Object.keys(updatePayload)) {
    const oldVal = existing?.[key] ?? null
    const newVal = updatePayload[key] ?? null
    // For cancelled_at, compare null vs truthy rather than exact timestamps
    if (key === "cancelled_at") {
      if ((!oldVal && !newVal) || (!!oldVal && !!newVal)) continue
    } else if (String(oldVal) === String(newVal)) {
      continue
    }
    before[key] = oldVal
    after[key] = newVal
  }

  // Nothing actually changed — return the existing event without side effects
  if (Object.keys(after).length === 0) {
    return NextResponse.json({ id: existing?.id, title: existing?.title, linked_channel_id: existing?.linked_channel_id })
  }

  // Only include changed fields in the DB update
  const filteredPayload: Record<string, unknown> = {}
  for (const key of Object.keys(after)) {
    filteredPayload[key] = updatePayload[key]
  }

  // Detect capacity increase before the update — the RPC will handle capacity atomically
  const oldCapacity = existing?.capacity as number | null
  const newCapacity = filteredPayload.capacity as number | undefined
  const capacityIncreased = newCapacity !== undefined &&
    (oldCapacity === null || (typeof newCapacity === "number" && newCapacity > oldCapacity))

  // Exclude capacity from the regular update if it increased — the RPC will set it atomically
  const nonCapacityPayload = { ...filteredPayload }
  if (capacityIncreased) {
    delete nonCapacityPayload.capacity
  }

  // Use service client to bypass RLS (creator may not have MANAGE_EVENTS role permission)
  // Only run the update if there are non-capacity fields to change
  let updated: { id: string; title: string; linked_channel_id: string | null }
  if (Object.keys(nonCapacityPayload).length > 0) {
    const { data, error } = await untypedFrom(service, "events")
      .update(nonCapacityPayload)
      .eq("id", params.eventId)
      .eq("server_id", params.serverId)
      .select("id,title,linked_channel_id")
      .single() as { data: { id: string; title: string; linked_channel_id: string | null } | null; error: { message: string } | null }
    if (error || !data) return NextResponse.json({ error: "Failed to update event" }, { status: 500 })
    updated = data
  } else {
    updated = { id: existing?.id as string, title: existing?.title as string, linked_channel_id: existing?.linked_channel_id as string | null }
  }

  // When capacity increased, atomically set capacity and promote waitlisted users
  if (capacityIncreased) {
    const { error: promoteError } = await service.rpc("set_event_capacity_and_promote", {
      p_event_id: params.eventId,
      p_server_id: params.serverId,
      p_new_capacity: newCapacity,
    })
    if (promoteError) {
      console.warn("set_event_capacity_and_promote failed", {
        eventId: params.eventId,
        error: promoteError.message,
      })
      return NextResponse.json({ error: "Failed to update capacity" }, { status: 500 })
    }
  } else if (newCapacity !== undefined && !capacityIncreased) {
    // Capacity decreased or stayed the same — just update the field (no promotions needed)
    const { error } = await untypedFrom(service, "events")
      .update({ capacity: newCapacity })
      .eq("id", params.eventId)
      .eq("server_id", params.serverId)
    if (error) return NextResponse.json({ error: "Failed to update event capacity" }, { status: 500 })
  }

  // Audit log
  const { error: auditError } = await service.from("audit_logs").insert({
    server_id: params.serverId,
    actor_id: user.id,
    action: parsed.cancelled ? "event_cancelled" : "event_updated",
    target_id: params.eventId,
    target_type: "event",
    changes: { before, after } as unknown as Json,
  })
  if (auditError) {
    console.warn("Failed to write event audit log", { eventId: params.eventId, error: auditError.message })
    return NextResponse.json({ error: "Failed to write audit log" }, { status: 500 })
  }

  // Notify attendees
  const { data: attendees } = await supabase
    .from("event_rsvps")
    .select("user_id")
    .eq("event_id", params.eventId)
    .in("status", ["going", "maybe", "waitlist"])

  if (attendees?.length) {
    const { error: notifyError } = await service.from("notifications").insert(
      attendees.map((attendee: { user_id: string }) => ({
        user_id: attendee.user_id,
        type: "system" as const,
        title: parsed.cancelled ? `Event cancelled: ${updated.title}` : `Event updated: ${updated.title}`,
        body: parsed.cancelled ? "An event you RSVP'd for has been cancelled." : "An event you RSVP'd for was updated.",
        server_id: params.serverId,
        channel_id: updated.linked_channel_id,
      }))
    )
    if (notifyError) {
      console.warn("Failed to send event update notifications", { eventId: params.eventId, error: notifyError.message })
    }
  }

  return NextResponse.json(updated)
  } catch (err) {
    console.error("[servers/[serverId]/events/[eventId] PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params: paramsPromise }: RouteContext
) {
  try {
    const params = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const service = await createServiceRoleClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { allowed, event } = await canManageEvent(supabase, params.serverId, params.eventId, user.id)
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: "You don't have permission to delete this event" }, { status: 403 })

    // Notify attendees before deletion
    const { data: attendees } = await supabase
      .from("event_rsvps")
      .select("user_id")
      .eq("event_id", params.eventId)
      .in("status", ["going", "maybe", "waitlist"])

    // Delete the event (cascades to hosts, rsvps, reminders via FK)
    const { error } = await service
      .from("events")
      .delete()
      .eq("id", params.eventId)
      .eq("server_id", params.serverId)

    if (error) return NextResponse.json({ error: "Failed to delete event" }, { status: 500 })

    // Audit log
    const { error: auditError } = await service.from("audit_logs").insert({
      server_id: params.serverId,
      actor_id: user.id,
      action: "event_deleted",
      target_id: params.eventId,
      target_type: "event",
      changes: {
        before: { title: event.title, start_at: event.start_at, created_by: event.created_by },
        after: null,
      } as unknown as Json,
    })
    if (auditError) {
      console.warn("Failed to write event delete audit log", { eventId: params.eventId, error: auditError.message })
      return NextResponse.json({ error: "Failed to write audit log" }, { status: 500 })
    }

    // Notify attendees
    if (attendees?.length) {
      const { error: notifyError } = await service.from("notifications").insert(
        attendees.map((attendee: { user_id: string }) => ({
          user_id: attendee.user_id,
          type: "system" as const,
          title: `Event deleted: ${event.title as string}`,
          body: "An event you RSVP'd for has been deleted.",
          server_id: params.serverId,
          channel_id: event.linked_channel_id as string | null,
        }))
      )
      if (notifyError) {
        console.warn("Failed to send event delete notifications", { eventId: params.eventId, error: notifyError.message })
      }
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error("[servers/[serverId]/events/[eventId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
