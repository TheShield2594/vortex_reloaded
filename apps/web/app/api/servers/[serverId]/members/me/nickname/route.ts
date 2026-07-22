import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"

type Params = { params: Promise<{ serverId: string }> }

/**
 * PATCH /api/servers/[serverId]/members/me/nickname
 * Update the current user's own nickname in the server.
 * Any server member can change their own nickname.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    const body = await req.json().catch(() => null)
    const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : null

    if (nickname !== null && nickname.length > 32) {
      return NextResponse.json({ error: "Nickname must be 32 characters or fewer" }, { status: 400 })
    }

    // Verify membership (RLS also enforces this, but fail fast with a clear error)
    const { data: member } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const { error: updateError } = await supabase
      .from("server_members")
      .update({ nickname: nickname || null })
      .eq("server_id", serverId)
      .eq("user_id", user.id)

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    return NextResponse.json({ ok: true, nickname: nickname || null })

  } catch (err) {
    console.error("[servers/[serverId]/members/me/nickname PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
