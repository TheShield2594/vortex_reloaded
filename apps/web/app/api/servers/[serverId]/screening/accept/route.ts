/**
 * POST /api/servers/[serverId]/screening/accept
 *
 * Records that the authenticated member has accepted the server's screening
 * rules.  Must be a current server member.
 */
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

type Params = { params: Promise<{ serverId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify membership
    const { data: membership } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!membership) return NextResponse.json({ error: "Not a server member" }, { status: 403 })

    const { error } = await supabase.from("member_screening").upsert(
      { server_id: serverId, user_id: user.id, accepted_at: new Date().toISOString() },
      { onConflict: "server_id,user_id" }
    )

    if (error) return NextResponse.json({ error: "Failed to accept screening" }, { status: 500 })

    // Audit — fire-and-forget; failure should not block the member's acceptance.
    void supabase.from("audit_logs").insert({
      server_id: serverId,
      actor_id: user.id,
      action: "screening_accepted",
      target_id: user.id,
      target_type: "user",
      changes: null,
    }).then(({ error }) => {
      if (error) console.error("[audit] screening_accepted insert failed:", error.message)
    })

    return NextResponse.json({ message: "Screening accepted" })

  } catch (err) {
    console.error("[servers/[serverId]/screening/accept POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
