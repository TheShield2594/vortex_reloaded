import { NextRequest, NextResponse } from "next/server"
import { APPEAL_STATUSES, isValidAppealStatus } from "@/lib/appeals"
import { requireModerator } from "@/lib/moderation-auth"

const TRIAGE_STATUSES = APPEAL_STATUSES.filter((status) => status === "submitted" || status === "reviewing")

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const { serverId } = await params
    const auth = await requireModerator(serverId)
    if (auth.error) return auth.error

    const status = new URL(req.url).searchParams.get("status")
    const query = auth.supabase
      .from("moderation_appeals")
      .select("id, user_id, status, submitted_at, assigned_reviewer_id, anti_abuse_score")
      .eq("server_id", serverId)
      .order("submitted_at", { ascending: true })

    if (status && isValidAppealStatus(status)) query.eq("status", status)
    else query.in("status", TRIAGE_STATUSES)

    const { data, error } = await query

    if (error) return NextResponse.json({ error: "Failed to fetch appeals" }, { status: 500 })
    return NextResponse.json(data ?? [])

  } catch (err) {
    console.error("[servers/[serverId]/appeals GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
