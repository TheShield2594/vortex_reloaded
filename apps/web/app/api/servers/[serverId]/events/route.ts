import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { sendPushToUser } from "@/lib/push"
import { untypedFrom } from "@/lib/supabase/untyped-table"

// New columns (event_type, external_url, banner_url) from migration 00060 are not yet
// reflected in the generated Supabase types. We use a typed interface and cast via unknown
// for the queries that reference those columns.
interface EventRow {
  id: string
  server_id: string
  title: string
  description: string | null
  location: string | null
  event_type: string | null
  external_url: string | null
  banner_url: string | null
  linked_channel_id: string | null
  voice_channel_id: string | null
  thread_id: string | null
  start_at: string
  end_at: string | null
  timezone: string
  recurrence: string
  recurrence_until: string | null
  capacity: number | null
  create_voice_channel: boolean
  post_event_thread: boolean
  created_by: string
  created_at: string
  updated_at: string
  event_hosts: Array<{ user_id: string }>
  event_rsvps: Array<{ user_id: string; status: string; users?: { id: string; display_name: string | null; avatar_url: string | null } }>
}

export async function GET(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string }> }
) {
  try {
    const params = await paramsPromise
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify the requester is a member of this server before any DB read
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", params.serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this server" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    // Cap RSVP nesting to 50 entries with user profiles for the attendee list.
    let query = untypedFrom(supabase, "events")
      .select(
        "id, server_id, title, description, location, event_type, external_url, banner_url, " +
        "linked_channel_id, voice_channel_id, thread_id, start_at, end_at, timezone, " +
        "recurrence, recurrence_until, capacity, create_voice_channel, post_event_thread, " +
        "created_by, created_at, updated_at, event_hosts(user_id), event_rsvps(user_id,status,users(id,display_name,avatar_url))"
      )
      .eq("server_id", params.serverId)
      .order("start_at", { ascending: true })

    if (from) query = query.gte("start_at", from)
    if (to) query = query.lte("start_at", to)

    const { data, error } = await query as { data: EventRow[] | null; error: { message: string } | null }
    if (error) return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 })

    const events = (data ?? []).map((event) => {
      const { event_rsvps, event_hosts, ...rest } = event
      const rsvps = event_rsvps ?? []
      return {
        ...rest,
        stats: {
          going: rsvps.filter((r) => r.status === "going").length,
          maybe: rsvps.filter((r) => r.status === "maybe").length,
          notGoing: rsvps.filter((r) => r.status === "not_going").length,
          waitlist: rsvps.filter((r) => r.status === "waitlist").length,
          interested: rsvps.filter((r) => r.status === "interested").length,
        },
        myRsvp: rsvps.find((r) => r.user_id === user.id) ?? null,
        hosts: (event_hosts ?? []).map((h) => h.user_id),
        // Cap attendees to 50 entries to limit payload size.
        attendees: rsvps
          .filter((r) => r.status === "going" || r.status === "maybe" || r.status === "interested")
          .slice(0, 50)
          .map((r) => ({
            user_id: r.user_id,
            status: r.status,
            display_name: r.users?.display_name ?? null,
            avatar_url: r.users?.avatar_url ?? null,
          })),
      }
    })

    return NextResponse.json(events)

  } catch (err) {
    console.error("[servers/[serverId]/events GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ serverId: string }> }
) {
  try {
  const params = await paramsPromise
  const supabase = await createServerSupabaseClient()
  const service = await createServiceRoleClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const perms = await getMemberPermissions(supabase, params.serverId, user.id)
  if (!perms.isAdmin && !hasPermission(perms.permissions, "MANAGE_EVENTS")) {
    return NextResponse.json({ error: "Missing MANAGE_EVENTS permission" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = body as {
    title?: unknown; description?: unknown; location?: unknown; eventType?: unknown;
    externalUrl?: unknown; bannerUrl?: unknown; linkedChannelId?: unknown; voiceChannelId?: unknown;
    startAt?: unknown; endAt?: unknown; timezone?: unknown; recurrence?: unknown;
    recurrenceUntil?: unknown; capacity?: unknown; createVoiceChannel?: unknown;
    postEventThread?: unknown; hosts?: unknown; linkedCategoryId?: unknown; notifyMembers?: unknown;
  }

  const title = String(parsed.title ?? "").trim()
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 })

  const validEventTypes = ["general", "voice", "external"]
  const eventType = typeof parsed.eventType === "string" && validEventTypes.includes(parsed.eventType) ? parsed.eventType : "general"

  const hosts = Array.isArray(parsed.hosts) ? (parsed.hosts as string[]) : []

  // New columns (event_type, external_url, banner_url) from migration 00060 are not yet
  // in the generated Supabase types, so we use Record<string, unknown> for the insert payload.
  const insertPayload: Record<string, unknown> = {
    server_id: params.serverId,
    title,
    description: parsed.description ?? null,
    location: parsed.location ?? null,
    event_type: eventType,
    external_url: eventType === "external" ? (parsed.externalUrl ?? null) : null,
    banner_url: parsed.bannerUrl ?? null,
    linked_channel_id: parsed.linkedChannelId ?? null,
    voice_channel_id: eventType === "voice" ? (parsed.voiceChannelId ?? null) : null,
    start_at: parsed.startAt,
    end_at: parsed.endAt,
    timezone: parsed.timezone ?? "UTC",
    recurrence: parsed.recurrence ?? "none",
    recurrence_until: parsed.recurrenceUntil ?? null,
    capacity: parsed.capacity ?? null,
    create_voice_channel: !!parsed.createVoiceChannel,
    post_event_thread: !!parsed.postEventThread,
    created_by: user.id,
  }

  // Cast needed because insertPayload includes columns not yet in generated types
  const { data: created, error } = await untypedFrom(supabase, "events")
    .insert(insertPayload)
    .select("*")
    .single() as { data: Record<string, unknown> | null; error: { message: string } | null }

  if (error || !created) return NextResponse.json({ error: "Database operation failed" }, { status: 500 })

  const createdId = created.id as string

  if (hosts.length > 0) {
    await supabase.from("event_hosts").insert(
      hosts.map((hostUserId: string) => ({ event_id: createdId, user_id: hostUserId }))
    )
  }

  if (parsed.createVoiceChannel) {
    const { data: voiceChannel } = await supabase
      .from("channels")
      .insert({
        server_id: params.serverId,
        type: "voice",
        name: `${title} Voice`,
        parent_id: (parsed.linkedCategoryId as string) ?? null,
      })
      .select("id")
      .single()

    if (voiceChannel?.id) {
      await supabase.from("events").update({ voice_channel_id: voiceChannel.id }).eq("id", createdId)
    }
  }

  if (parsed.postEventThread && parsed.linkedChannelId) {
    const { data: message } = await supabase
      .from("messages")
      .insert({
        channel_id: parsed.linkedChannelId as string,
        author_id: user.id,
        content: `\uD83D\uDCC5 **${title}**\n${(parsed.description as string) ?? "Event created"}`,
      })
      .select("id")
      .single()

    if (message?.id) {
      const { data: thread } = await supabase.rpc("create_thread_from_message", {
        p_message_id: message.id,
        p_name: `${title} discussion`,
      })
      if (thread?.id) {
        // thread_id column from migration 00060 is not yet in generated types
        await (supabase.from("events").update({ thread_id: thread.id }).eq("id", createdId) as unknown as Promise<{ error: { message: string } | null }>)
      }
    }
  }

  if (parsed.notifyMembers) {
    const { data: members } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", params.serverId)
    if (members?.length) {
      // In-app notifications
      await service.from("notifications").insert(
        members.map((member: { user_id: string }) => ({
          user_id: member.user_id,
          type: "system" as const,
          title: `New event: ${title}`,
          body: "A new event has been scheduled.",
          server_id: params.serverId,
          channel_id: (parsed.linkedChannelId as string) ?? null,
        }))
      )

      // Push notifications for all server members (except event creator)
      const { data: serverInfo } = await supabase.from("servers").select("name").eq("id", params.serverId).maybeSingle()
      const serverName = serverInfo?.name ?? "a server"
      const startDate = parsed.startAt ? new Date(String(parsed.startAt)).toLocaleString() : ""
      await Promise.allSettled(
        members
          .filter((m: { user_id: string }) => m.user_id !== user.id)
          .map((m: { user_id: string }) =>
            sendPushToUser(m.user_id, {
              title: `📅 New event in ${serverName}`,
              body: `${title}${startDate ? ` — ${startDate}` : ""}`,
              url: `/channels/${params.serverId}`,
              tag: `event-${createdId}`,
            })
          )
      )
    }
  }

  return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error("[servers/[serverId]/events POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
