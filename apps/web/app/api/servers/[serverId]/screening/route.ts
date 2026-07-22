/**
 * GET    /api/servers/[serverId]/screening  – get screening config
 * PUT    /api/servers/[serverId]/screening  – upsert screening config (owner only)
 * DELETE /api/servers/[serverId]/screening  – remove screening config (owner only)
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

type Params = { params: Promise<{ serverId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Any server member can view the screening config (needed to show the rules on join)
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const { data, error } = await supabase
      .from("screening_configs")
      .select("*")
      .eq("server_id", serverId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: "Failed to fetch screening config" }, { status: 500 })

    // Also return whether the current user has already accepted
    const { data: accepted } = await supabase
      .from("member_screening")
      .select("accepted_at")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    return NextResponse.json({ config: data, accepted: !!accepted, accepted_at: accepted?.accepted_at ?? null })

  } catch (err) {
    console.error("[servers/[serverId]/screening GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
  const { serverId } = await params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: server } = await supabase.from("servers").select("owner_id").eq("id", serverId).single()
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 })
  if (server.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  let title: unknown, description: unknown, rules_text: unknown, require_acceptance: unknown
  try {
    ;({ title, description, rules_text, require_acceptance } = await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("screening_configs")
    .upsert(
      {
        server_id: serverId,
        title: (title as string) ?? "Server Rules",
        description: (description as string) ?? null,
        rules_text: (rules_text as string) ?? "",
        require_acceptance: (require_acceptance as boolean) ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "server_id" }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Failed to update screening config" }, { status: 500 })
  return NextResponse.json(data)
  } catch (err) {
    console.error("[servers/[serverId]/screening PUT] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: server } = await supabase.from("servers").select("owner_id").eq("id", serverId).single()
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 })
    if (server.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { error, count } = await supabase
      .from("screening_configs")
      .delete()
      .eq("server_id", serverId)

    if (error) return NextResponse.json({ error: "Failed to delete screening config" }, { status: 500 })
    if (count === 0) return NextResponse.json({ error: "Screening config not found" }, { status: 404 })

    return NextResponse.json({ message: "Screening config removed" })

  } catch (err) {
    console.error("[servers/[serverId]/screening DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
