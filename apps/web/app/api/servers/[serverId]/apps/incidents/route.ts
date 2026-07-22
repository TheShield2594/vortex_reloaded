import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { SYSTEM_BOT_ID } from "@/lib/server-auth"

type Params = { params: Promise<{ serverId: string }> }

/**
 * GET /api/servers/[serverId]/apps/incidents
 * Returns incident config + incidents list.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, error: permError } = await requireServerPermission(serverId, "SEND_MESSAGES")
    if (permError) return permError

    const [configResult, incidentsResult] = await Promise.all([
      supabase
        .from("incident_app_configs")
        .select("*")
        .eq("server_id", serverId)
        .maybeSingle(),
      supabase
        .from("incidents")
        .select("*, incident_updates(count)")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(50),
    ])

    if (configResult.error) return NextResponse.json({ error: "Failed to fetch incident configuration" }, { status: 500 })
    if (incidentsResult.error) return NextResponse.json({ error: "Failed to fetch incidents" }, { status: 500 })

    return NextResponse.json({
      config: configResult.data,
      incidents: incidentsResult.data ?? [],
    })

  } catch (err) {
    console.error("[servers/[serverId]/apps/incidents GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/apps/incidents
 * Actions: save_config, create_incident
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const action = body.action as string

  // Save config
  if (action === "save_config") {
    const { error: permError } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (permError) return permError

    const { channel_id, severity_labels, enabled } = body as {
      channel_id?: string | null
      severity_labels?: string[]
      enabled?: boolean
    }

    if (channel_id) {
      const { data: ch } = await supabase
        .from("channels")
        .select("id")
        .eq("id", channel_id)
        .eq("server_id", serverId)
        .single()
      if (!ch) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
    }

    if (severity_labels && (!Array.isArray(severity_labels) || severity_labels.length < 1 || severity_labels.length > 10)) {
      return NextResponse.json({ error: "severity_labels must be 1-10 items" }, { status: 400 })
    }

    const upsertData = {
      server_id: serverId,
      ...(channel_id !== undefined && { channel_id }),
      ...(severity_labels !== undefined && { severity_labels: JSON.stringify(severity_labels) }),
      ...(enabled !== undefined && { enabled }),
    }

    const { data, error } = await supabase
      .from("incident_app_configs")
      .upsert(upsertData, { onConflict: "server_id" })
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: "Failed to save incident configuration" }, { status: 500 })
    return NextResponse.json(data)
  }

  // Create incident
  if (action === "create_incident") {
    const { error: permError } = await requireServerPermission(serverId, "MANAGE_MESSAGES")
    if (permError) return permError

    const { title, description, severity } = body as {
      title?: string
      description?: string
      severity?: string
    }

    if (!title || title.length > 200) {
      return NextResponse.json({ error: "title is required (max 200 chars)" }, { status: 400 })
    }

    // Determine channel
    const { data: config } = await supabase
      .from("incident_app_configs")
      .select("channel_id")
      .eq("server_id", serverId)
      .maybeSingle()

    if (!config?.channel_id) {
      return NextResponse.json({ error: "No incident channel configured. Set one first." }, { status: 400 })
    }

    const { data: incident, error: insertError } = await supabase
      .from("incidents")
      .insert({
        server_id: serverId,
        channel_id: config.channel_id,
        title,
        description: description || null,
        severity: severity || "SEV3 - Minor",
        commander_id: user.id,
        created_by: user.id,
      })
      .select("*")
      .single()

    if (insertError) return NextResponse.json({ error: "Failed to create incident" }, { status: 500 })

    // Post announcement
    const serviceClient = await createServiceRoleClient()
    const { data: profile } = await serviceClient
      .from("users")
      .select("display_name, username")
      .eq("id", user.id)
      .single()

    const commander = profile?.display_name || profile?.username || "Unknown"

    await serviceClient.from("messages").insert({
      channel_id: config.channel_id,
      author_id: SYSTEM_BOT_ID,
      content: [
        `**INCIDENT OPENED** — ${incident.severity}`,
        `**${title}**`,
        description ? `\n${description}` : "",
        `\nCommander: **${commander}**`,
        `Status: **Investigating**`,
        `\nUse \`/iupdate ${incident.id.slice(0, 8)} <message>\` to post updates`,
        `Use \`/iresolve ${incident.id.slice(0, 8)}\` when resolved`,
      ].filter(Boolean).join("\n"),
    })

    // Create initial timeline entry
    await supabase.from("incident_updates").insert({
      incident_id: incident.id,
      author_id: user.id,
      status: "investigating",
      message: `Incident opened: ${title}`,
    })

    return NextResponse.json(incident, { status: 201 })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[servers/[serverId]/apps/incidents POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
