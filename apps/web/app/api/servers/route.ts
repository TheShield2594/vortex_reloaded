import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { checkRateLimit } from "@/lib/utils/api-helpers"

/**
 * POST /api/servers
 *
 * Creates a plain (non-template) server. Returns the created row directly
 * using the service-role client to avoid the PostgREST RLS timing issue
 * where INSERT RETURNING can't read back the row before the AFTER INSERT
 * trigger adds the owner to server_members.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let userId: string | undefined
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = user.id

    const limited = await checkRateLimit(user.id, "servers:create", { limit: 10, windowMs: 3600_000 })
    if (limited) return limited

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const parsed = body as Record<string, unknown>
    const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    if (name.length > 100) {
      return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 })
    }

    const rawIconUrl = typeof parsed.iconUrl === "string" && parsed.iconUrl !== "" ? parsed.iconUrl : null
    let iconUrl: string | null = null
    if (rawIconUrl) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const expectedPrefix = supabaseUrl
        ? `${supabaseUrl}/storage/v1/object/public/server-icons/${user.id}/`
        : null
      if (!expectedPrefix || !rawIconUrl.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Invalid iconUrl" }, { status: 400 })
      }
      iconUrl = rawIconUrl
    }

    // Use the service-role client for insert+select to bypass the RLS timing
    // issue. The AFTER INSERT trigger on servers adds the owner to
    // server_members, but PostgREST's RETURNING clause runs before AFTER
    // triggers, so the SELECT RLS policy (which checks server_members) would
    // reject the row. Service-role bypasses RLS entirely.
    const serviceClient = await createServiceRoleClient()
    const { data: server, error: insertError } = await serviceClient
      .from("servers")
      .insert({
        name,
        owner_id: user.id,
        icon_url: iconUrl || undefined,
      })
      .select()
      .single()

    if (insertError || !server) {
      console.error("Server creation failed:", {
        route: "/api/servers",
        action: "create-server",
        userId: user.id,
        error: insertError?.message ?? "Insert returned no row",
      })
      return NextResponse.json({ error: "Failed to create server" }, { status: 500 })
    }

    return NextResponse.json({ server }, { status: 201 })
  } catch (error) {
    console.error("POST /api/servers unexpected failure:", {
      route: "/api/servers",
      action: "create-server",
      userId,
      error: error instanceof Error ? error.message : error,
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
