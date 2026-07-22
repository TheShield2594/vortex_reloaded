import { NextRequest, NextResponse } from "next/server"
import { requireServerPermission } from "@/lib/server-auth"

type Params = { params: Promise<{ serverId: string }> }

/**
 * GET /api/servers/[serverId]/apps/welcome
 * Returns the welcome app configuration for this server.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
    if (error) return error

    const { data, error: fetchError } = await supabase
      .from("welcome_app_configs")
      .select("*")
      .eq("server_id", serverId)
      .maybeSingle()

    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    return NextResponse.json(data)

  } catch (err) {
    console.error("[servers/[serverId]/apps/welcome GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/servers/[serverId]/apps/welcome
 * Create or update the welcome app configuration.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serverId } = await params
  const { supabase, error } = await requireServerPermission(serverId, "MANAGE_CHANNELS")
  if (error) return error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const {
    channel_id,
    welcome_message,
    rules,
    embed_color,
    dm_on_join,
    dm_message,
    auto_role_ids,
    enabled,
  } = body as {
    channel_id?: string | null
    welcome_message?: string
    rules?: string[]
    embed_color?: string
    dm_on_join?: boolean
    dm_message?: string | null
    auto_role_ids?: string[]
    enabled?: boolean
  }

  // Validate channel belongs to this server if provided
  if (channel_id) {
    const { data: channel } = await supabase
      .from("channels")
      .select("id")
      .eq("id", channel_id)
      .eq("server_id", serverId)
      .single()
    if (!channel) return NextResponse.json({ error: "Channel not found in this server" }, { status: 400 })
  }

  // Validate welcome message length
  if (welcome_message && welcome_message.length > 2000) {
    return NextResponse.json({ error: "Welcome message too long (max 2000 chars)" }, { status: 400 })
  }

  // Validate rules array
  if (rules && (!Array.isArray(rules) || rules.length > 25)) {
    return NextResponse.json({ error: "Rules must be an array with at most 25 items" }, { status: 400 })
  }

  // Validate embed color format
  if (embed_color && !/^#[0-9a-fA-F]{6}$/.test(embed_color)) {
    return NextResponse.json({ error: "Invalid embed color format (use #RRGGBB)" }, { status: 400 })
  }

  const upsertData = {
    server_id: serverId,
    ...(channel_id !== undefined && { channel_id }),
    ...(welcome_message !== undefined && { welcome_message }),
    ...(rules !== undefined && { rules: JSON.stringify(rules) }),
    ...(embed_color !== undefined && { embed_color }),
    ...(dm_on_join !== undefined && { dm_on_join }),
    ...(dm_message !== undefined && { dm_message }),
    ...(auto_role_ids !== undefined && { auto_role_ids }),
    ...(enabled !== undefined && { enabled }),
  }

  const { data, error: upsertError } = await supabase
    .from("welcome_app_configs")
    .upsert(upsertData, { onConflict: "server_id" })
    .select("*")
    .single()

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })
  return NextResponse.json(data)
}
