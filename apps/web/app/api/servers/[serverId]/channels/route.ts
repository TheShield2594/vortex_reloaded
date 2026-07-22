import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

type Params = { params: Promise<{ serverId: string }> }

/**
 * GET /api/servers/[serverId]/channels
 * Returns all channels in this server the user has access to (via RLS).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify the user is a member of this server
    const { data: member, error: memberError } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberError) return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data, error } = await supabase
      .from("channels")
      .select("id, name, type, position, parent_id")
      .eq("server_id", serverId)
      .order("position", { ascending: true })

    if (error) return NextResponse.json({ error: "Failed to fetch channels" }, { status: 500 })
    return NextResponse.json(data ?? [])
  } catch (err) {
    return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
  }
}
