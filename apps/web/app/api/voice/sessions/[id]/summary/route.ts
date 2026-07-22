import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/voice/sessions/{id}/summary
 *
 * Retrieve the post-call summary for a session.
 * Returns 404 when no summary exists yet (status still pending/failed).
 *
 * Required scope: voice:sessions:read (enforced via RLS).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: sessionId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Also fetch the session's summary_status so the client knows whether to poll
    const { data: session } = await supabase
      .from("voice_call_sessions")
      .select("id, summary_status")
      .eq("id", sessionId)
      .maybeSingle()

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    if (session.summary_status !== "ready") {
      return NextResponse.json({ summary: null, status: session.summary_status }, { status: 200 })
    }

    const { data: summary, error } = await supabase
      .from("voice_call_summaries")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: "Failed to fetch summary" }, { status: 500 })
    }

    return NextResponse.json({ summary, status: session.summary_status })

  } catch (err) {
    console.error("[voice/sessions/[id]/summary GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
