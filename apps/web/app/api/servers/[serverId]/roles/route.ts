import { type NextRequest, NextResponse } from "next/server"
import { requireAuth, parseJsonBody, insertAuditLog } from "@/lib/utils/api-helpers"
import { requireServerPermission } from "@/lib/server-auth"
import { invalidatePrefix } from "@/lib/server-cache"
import { invalidateServerPermissions } from "@/lib/permissions"

type Params = { params: Promise<{ serverId: string }> }

export async function GET(
  _request: NextRequest,
  { params: paramsPromise }: Params
) {
  try {
    const { serverId } = await paramsPromise
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    // Verify the caller is a member of this server before exposing role data
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!membership) {
      // Also allow the server owner (who may not have a server_members row in edge cases)
      const { data: server } = await supabase
        .from("servers")
        .select("owner_id")
        .eq("id", serverId)
        .single()

      if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 })
      if (server.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: roles, error } = await supabase
      .from("roles")
      .select("*")
      .eq("server_id", serverId)
      .order("position", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 })

    return NextResponse.json(roles)

  } catch (err) {
    console.error("[servers/[serverId]/roles GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface CreateRoleBody {
  name?: string
  color?: string
  permissions?: number
  position?: number
  is_hoisted?: boolean
  mentionable?: boolean
}

export async function POST(
  request: NextRequest,
  { params: paramsPromise }: Params
) {
  try {
    const { serverId } = await paramsPromise

    // Permission check: must be owner or have MANAGE_ROLES
    const { supabase, user, error: permError } = await requireServerPermission(serverId, "MANAGE_ROLES")
    if (permError) return permError

    const { data: body, error: parseError } = await parseJsonBody<CreateRoleBody>(request)
    if (parseError || !body) return parseError ?? NextResponse.json({ error: "Malformed JSON" }, { status: 400 })

    // Input validation
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "New Role"
    if (name.length === 0) return NextResponse.json({ error: "Role name cannot be empty" }, { status: 400 })

    const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#99aab5"
    const permissions = typeof body.permissions === "number" && Number.isInteger(body.permissions) && body.permissions >= 0
      ? body.permissions
      : 3
    const position = typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0
      ? body.position
      : 0
    const is_hoisted = typeof body.is_hoisted === "boolean" ? body.is_hoisted : false
    const mentionable = typeof body.mentionable === "boolean" ? body.mentionable : false

    const { data: role, error } = await supabase
      .from("roles")
      .insert({
        server_id: serverId,
        name,
        color,
        permissions,
        position,
        is_hoisted,
        mentionable,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: "Failed to create role" }, { status: 500 })

    await insertAuditLog(supabase, {
      server_id: serverId,
      actor_id: user.id,
      action: "role_create",
      target_id: role.id,
      target_type: "role",
      changes: { name, color, permissions, position, is_hoisted, mentionable },
    })

    try {
      invalidatePrefix(`roles:${serverId}`)
      invalidateServerPermissions(serverId)
    } catch (cacheErr) {
      console.error("[roles POST] cache invalidation failed", { serverId, error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) })
    }

    return NextResponse.json(role, { status: 201 })

  } catch (err) {
    console.error("[servers/[serverId]/roles POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
