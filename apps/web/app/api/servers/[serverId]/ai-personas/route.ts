import { NextRequest, NextResponse } from "next/server"
import { requireServerOwner, requireServerPermission } from "@/lib/server-auth"

type Params = { params: Promise<{ serverId: string }> }

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

/**
 * GET /api/servers/[serverId]/ai-personas
 *
 * List all active AI personas for a server.
 * Any server member with VIEW_CHANNELS can see personas (needed for autocomplete).
 */
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerPermission(serverId, "VIEW_CHANNELS")
    if (error) return error

    const { data: personas, error: queryError } = await supabase
      .from("ai_personas")
      .select("id, name, avatar_url, description, system_prompt, is_active, allowed_channel_ids, created_at")
      .eq("server_id", serverId)
      .eq("is_active", true)
      .order("name", { ascending: true })

    if (queryError) {
      console.error("[ai-personas GET] query error:", queryError)
      return NextResponse.json({ error: "Failed to load personas" }, { status: 500 })
    }

    return NextResponse.json({ personas: personas ?? [] })
  } catch (err) {
    console.error("[ai-personas GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * POST /api/servers/[serverId]/ai-personas
 *
 * Create a new AI persona. Server owner only.
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId } = await params
    const { supabase, user, error } = await requireServerOwner(serverId)
    if (error) return error
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const data = body as Record<string, unknown>

    // Validate required fields
    const name = typeof data.name === "string" ? data.name.trim() : ""
    if (name.length < 1 || name.length > 32) {
      return NextResponse.json({ error: "Name must be 1-32 characters" }, { status: 400 })
    }

    const systemPrompt = typeof data.systemPrompt === "string" ? data.systemPrompt.trim() : ""
    if (systemPrompt.length === 0) {
      return NextResponse.json({ error: "System prompt is required" }, { status: 400 })
    }
    if (systemPrompt.length > 4000) {
      return NextResponse.json({ error: "System prompt must be under 4000 characters" }, { status: 400 })
    }

    const description = typeof data.description === "string" ? data.description.trim() || null : null
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() || null : null
    const providerConfigId = typeof data.providerConfigId === "string" ? data.providerConfigId : null
    const allowedChannelIds = isStringArray(data.allowedChannelIds) ? data.allowedChannelIds : []

    const { data: persona, error: insertError } = await supabase
      .from("ai_personas")
      .insert({
        server_id: serverId,
        name,
        system_prompt: systemPrompt,
        description,
        avatar_url: avatarUrl,
        provider_config_id: providerConfigId,
        allowed_channel_ids: allowedChannelIds,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "A persona with that name already exists" }, { status: 409 })
      }
      console.error("[ai-personas POST] insert error:", insertError)
      return NextResponse.json({ error: "Failed to create persona" }, { status: 500 })
    }

    return NextResponse.json({ persona }, { status: 201 })
  } catch (err) {
    console.error("[ai-personas POST] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH /api/servers/[serverId]/ai-personas
 *
 * Update or delete a persona. Server owner only.
 * Body: { action: "update", personaId, ...fields } or { action: "delete", personaId }
 */
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { serverId } = await params
    const { supabase, error } = await requireServerOwner(serverId)
    if (error) return error

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const data = body as Record<string, unknown>
    const personaId = data.personaId
    if (typeof personaId !== "string") {
      return NextResponse.json({ error: "personaId is required" }, { status: 400 })
    }

    if (data.action === "delete") {
      const { error: deleteError } = await supabase
        .from("ai_personas")
        .delete()
        .eq("id", personaId)
        .eq("server_id", serverId)

      if (deleteError) {
        console.error("[ai-personas PATCH delete] error:", deleteError)
        return NextResponse.json({ error: "Failed to delete persona" }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    // Update — validate fields with same rules as POST
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof data.name === "string") {
      const name = data.name.trim()
      if (name.length < 1 || name.length > 32) {
        return NextResponse.json({ error: "Name must be 1-32 characters" }, { status: 400 })
      }
      updates.name = name
    }

    if (typeof data.systemPrompt === "string") {
      const prompt = data.systemPrompt.trim()
      if (prompt.length === 0) {
        return NextResponse.json({ error: "System prompt cannot be empty" }, { status: 400 })
      }
      if (prompt.length > 4000) {
        return NextResponse.json({ error: "System prompt must be under 4000 characters" }, { status: 400 })
      }
      updates.system_prompt = prompt
    }

    if (typeof data.description === "string") updates.description = data.description.trim() || null
    if (typeof data.avatarUrl === "string") updates.avatar_url = data.avatarUrl.trim() || null
    if (typeof data.isActive === "boolean") updates.is_active = data.isActive
    if (typeof data.providerConfigId === "string" || data.providerConfigId === null) {
      updates.provider_config_id = data.providerConfigId
    }
    if (isStringArray(data.allowedChannelIds)) updates.allowed_channel_ids = data.allowedChannelIds

    const { error: updateError } = await supabase
      .from("ai_personas")
      .update(updates)
      .eq("id", personaId)
      .eq("server_id", serverId)

    if (updateError) {
      console.error("[ai-personas PATCH update] error:", updateError)
      return NextResponse.json({ error: "Failed to update persona" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[ai-personas PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
