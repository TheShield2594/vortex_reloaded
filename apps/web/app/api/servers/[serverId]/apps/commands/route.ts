import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { aggregateMemberPermissions } from "@/lib/server-auth"

/**
 * GET /api/servers/[serverId]/apps/commands
 *
 * Returns the list of slash commands available in a server — i.e. commands
 * belonging to apps that are currently installed on the server.
 * Also returns the requesting user's effective permission bitmask and
 * ownership status so the client can gate built-in moderation commands.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Fetch member roles + server ownership in parallel with app installs
    const [memberResult, serverResult, installsResult] = await Promise.all([
      supabase
        .from("server_members")
        .select("user_id, member_roles(roles(permissions))")
        .eq("server_id", serverId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("servers")
        .select("owner_id")
        .eq("id", serverId)
        .single(),
      supabase
        .from("server_app_installs")
        .select("app_id")
        .eq("server_id", serverId),
    ])

    if (!serverResult.data) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 })
    }

    if (!memberResult.data) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 })
    }

    interface MemberRoleJoin { roles: { permissions: number } | null }
    const memberData = memberResult.data as { member_roles?: MemberRoleJoin[] } | null
    const permissions = aggregateMemberPermissions(memberData?.member_roles ?? [])
    const isOwner = serverResult.data.owner_id === user.id

    // Build app commands list
    let appCommands: Array<{ id: string; appId: string; appName: string; commandName: string; description: string | null }> = []

    const installs = installsResult.data
    if (installs && installs.length > 0) {
      const appIds = installs.map((i) => i.app_id)
      const { data: commands } = await supabase
        .from("app_commands")
        .select("id, app_id, command_name, description, app_catalog(name)")
        .in("app_id", appIds)
        .eq("enabled", true)

      appCommands = (commands ?? []).map((cmd) => ({
        id: cmd.id,
        appId: cmd.app_id,
        appName: (cmd.app_catalog as unknown as { name: string } | null)?.name ?? cmd.app_id,
        commandName: cmd.command_name,
        description: cmd.description ?? null,
      }))
    }

    return NextResponse.json({
      commands: appCommands,
      permissions,
      isOwner,
    })

  } catch (err) {
    console.error("[servers/[serverId]/apps/commands GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
