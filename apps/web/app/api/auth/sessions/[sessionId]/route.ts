import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { untypedFrom } from "@/lib/supabase/untyped-table"

export async function DELETE(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: session, error: sessionLookupError } = await untypedFrom(supabase, "auth_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", auth.user.id)
      .maybeSingle()

    if (sessionLookupError) {
      return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
    }

    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })

    const { error } = await untypedFrom(supabase, "auth_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", auth.user.id)
      .is("revoked_at", null)

    if (error) return NextResponse.json({ error: "Failed to revoke session" }, { status: 500 })

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error("[auth/sessions/[sessionId] DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
