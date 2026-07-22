import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"

type Params = { params: Promise<{ serverId: string; incidentId: string }> }

/**
 * GET /api/servers/[serverId]/apps/incidents/[incidentId]
 * Returns incident details with full timeline.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId, incidentId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: incident } = await supabase
      .from("incidents")
      .select("*")
      .eq("id", incidentId)
      .eq("server_id", serverId)
      .maybeSingle()

    if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 })

    const { data: updates } = await supabase
      .from("incident_updates")
      .select("id, author_id, status, message, created_at, users:author_id(display_name, username)")
      .eq("incident_id", incidentId)
      .order("created_at", { ascending: true })

    return NextResponse.json({ incident, updates: updates ?? [] })

  } catch (err) {
    console.error("[servers/[serverId]/apps/incidents/[incidentId] GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/apps/incidents/[incidentId]
 * Actions: update, resolve
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serverId, incidentId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { action?: string; message?: string; status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Resolve incident — support both full UUID and short prefix
  let incident: Record<string, unknown> | null = null
  const { data: exactMatch } = await supabase
    .from("incidents")
    .select("*")
    .eq("id", incidentId)
    .eq("server_id", serverId)
    .maybeSingle()

  if (exactMatch) {
    incident = exactMatch
  } else {
    const { data: prefixMatches } = await supabase
      .from("incidents")
      .select("*")
      .eq("server_id", serverId)
      .like("id", `${incidentId}%`)
      .limit(2)
    if (prefixMatches && prefixMatches.length === 1) {
      incident = prefixMatches[0]
    }
  }

  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 })

  const incidentRecord = incident as {
    id: string
    channel_id: string
    title: string
    severity: string
    status: string
  }

  const validStatuses = ["investigating", "identified", "monitoring", "resolved"]

  // Post update
  if (body.action === "update") {
    if (!body.message || body.message.length > 2000) {
      return NextResponse.json({ error: "message is required (max 2000 chars)" }, { status: 400 })
    }

    const newStatus = body.status && validStatuses.includes(body.status) ? body.status : incidentRecord.status

    // Add timeline entry
    const { error: updateError } = await supabase.from("incident_updates").insert({
      incident_id: incidentRecord.id,
      author_id: user.id,
      status: newStatus,
      message: body.message,
    })
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    // Update incident status
    if (newStatus !== incidentRecord.status) {
      await supabase
        .from("incidents")
        .update({ status: newStatus })
        .eq("id", incidentRecord.id)
    }

    // Post in channel
    const serviceClient = await createServiceRoleClient()
    const { data: profile } = await serviceClient
      .from("users")
      .select("display_name, username")
      .eq("id", user.id)
      .single()
    const authorName = profile?.display_name || profile?.username || "Unknown"

    await serviceClient.from("messages").insert({
      channel_id: incidentRecord.channel_id,
      author_id: SYSTEM_BOT_ID,
      content: `**INCIDENT UPDATE** — ${incidentRecord.title}\nStatus: **${newStatus}**\n${body.message}\n— ${authorName}`,
    })

    return NextResponse.json({ ok: true, message: "Update posted" })
  }

  // Resolve
  if (body.action === "resolve") {
    if (incidentRecord.status === "resolved") {
      return NextResponse.json({ error: "Incident is already resolved" }, { status: 400 })
    }

    const resolveMessage = body.message || "Incident resolved"

    await supabase
      .from("incidents")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", incidentRecord.id)

    await supabase.from("incident_updates").insert({
      incident_id: incidentRecord.id,
      author_id: user.id,
      status: "resolved",
      message: resolveMessage,
    })

    const serviceClient = await createServiceRoleClient()
    const { data: profile } = await serviceClient
      .from("users")
      .select("display_name, username")
      .eq("id", user.id)
      .single()
    const authorName = profile?.display_name || profile?.username || "Unknown"

    await serviceClient.from("messages").insert({
      channel_id: incidentRecord.channel_id,
      author_id: SYSTEM_BOT_ID,
      content: `**INCIDENT RESOLVED** — ${incidentRecord.title}\n${resolveMessage}\n— ${authorName}`,
    })

    return NextResponse.json({ ok: true, message: "Incident resolved" })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
