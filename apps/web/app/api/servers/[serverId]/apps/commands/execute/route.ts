import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getMemberPermissions, hasPermission } from "@/lib/permissions"
import { AppInteractionRuntime } from "@/lib/apps/runtime"

/**
 * POST /api/servers/[serverId]/apps/commands/execute
 *
 * Executes a registered slash command for an installed app.
 *
 * Body: { commandId: string, appId: string, args?: string }
 *
 * Permission required: USE_APPLICATION_COMMANDS (or ADMINISTRATOR / server owner).
 * Rate-limit data is sourced from app_rate_limits; enforcement is in-process via
 * AppInteractionRuntime (stateless per-request — suitable for serverless).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Permission check
  const { isAdmin, permissions } = await getMemberPermissions(supabase, serverId, user.id)
  if (!isAdmin && !hasPermission(permissions, "USE_APPLICATION_COMMANDS")) {
    return NextResponse.json({ error: "Missing USE_APPLICATION_COMMANDS permission." }, { status: 403 })
  }

  let body: { commandId?: string; appId?: string; args?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { commandId, appId, args } = body
  if (!commandId || !appId) {
    return NextResponse.json({ error: "commandId and appId are required" }, { status: 400 })
  }
  if (typeof args === "string" && args.length > 4000) {
    return NextResponse.json({ error: "args too long (max 4000 chars)" }, { status: 400 })
  }

  // Verify the command exists, is enabled, and the app is installed on this server
  const [{ data: command, error: commandError }, { data: install, error: installError }] = await Promise.all([
    supabase
      .from("app_commands")
      .select("id, app_id, command_name, description, schema")
      .eq("id", commandId)
      .eq("app_id", appId)
      .eq("enabled", true)
      .single(),
    supabase
      .from("server_app_installs")
      .select("id")
      .eq("server_id", serverId)
      .eq("app_id", appId)
      .maybeSingle(),
  ])

  if (commandError || !command) return NextResponse.json({ error: "Command not found or disabled." }, { status: 404 })
  if (installError) {
    console.error("[servers/[serverId]/apps/commands/execute POST] install check error:", installError.message)
    return NextResponse.json({ error: "Failed to verify app installation" }, { status: 500 })
  }
  if (!install) return NextResponse.json({ error: "App is not installed on this server." }, { status: 403 })

  // Fetch rate limit config for this app
  const { data: rateLimit } = await supabase
    .from("app_rate_limits")
    .select("requests_per_minute")
    .eq("app_id", appId)
    .maybeSingle()

  // Build a per-request runtime and register the command.
  // Commands that need real side-effects (posting messages, etc.) would be
  // implemented by webhook delivery — this layer validates and audits the call.
  const runtime = new AppInteractionRuntime()
  runtime.registerCommand({
    name: command.command_name,
    appId: command.app_id,
    description: command.description ?? undefined,
    execute: async () => ({ ok: true, message: `Command /${command.command_name} received.` }),
  })

  const result = await runtime.executeCommand(
    command.command_name,
    { appId: command.app_id, serverId, actorId: user.id, payload: { args: args ?? "" } },
    rateLimit ? { requestsPerMinute: rateLimit.requests_per_minute } : undefined
  )

  // Track usage
  await supabase.rpc("bump_app_usage", {
    p_app_id: appId,
    p_server_id: serverId,
    p_metric_key: `command.${command.command_name}`,
    p_metric_value: 1,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 429 })
  }

  return NextResponse.json({ ok: true, message: result.message })
}
