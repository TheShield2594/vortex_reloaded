import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { StartSessionRequest } from "@/types/vortex-recap"

/**
 * POST /api/voice/sessions
 *
 * Start a new voice intelligence session.
 * Idempotency: if a non-ended session already exists for the same scope_id
 * and started_by user, returns that existing session (200) instead of creating
 * a duplicate.
 *
 * Required scope: authenticated user (voice:sessions:create implied by auth).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: StartSessionRequest
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { scopeType, scopeId, transcriptionMode } = body

    if (!scopeType || !scopeId) {
      return NextResponse.json({ error: "scopeType and scopeId are required" }, { status: 400 })
    }

    if (!["server_channel", "dm_call"].includes(scopeType)) {
      return NextResponse.json({ error: "Invalid scopeType" }, { status: 400 })
    }

    const mode = transcriptionMode ?? "off"
    if (!["off", "manual_opt_in", "server_policy_required"].includes(mode)) {
      return NextResponse.json({ error: "Invalid transcriptionMode" }, { status: 400 })
    }

    const VOICE_SESSION_SELECT = "id, started_by, scope_id, scope_type, transcription_mode, summary_status, started_at, created_at, ended_at"

    // Idempotency: return an existing active session for this user + scope
    const { data: existing, error: existingError } = await supabase
      .from("voice_call_sessions")
      .select(VOICE_SESSION_SELECT)
      .eq("started_by", user.id)
      .eq("scope_id", scopeId)
      .is("ended_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      console.error("[voice/sessions] idempotency check failed", { userId: user.id, scopeId, error: existingError.message })
      return NextResponse.json({ error: "Failed to check existing session" }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json({ session: existing }, { status: 200 })
    }

    const { data: session, error } = await supabase
      .from("voice_call_sessions")
      .insert({
        scope_type: scopeType,
        scope_id: scopeId,
        started_by: user.id,
        transcription_mode: mode,
        summary_status: "pending",
      })
      .select(VOICE_SESSION_SELECT)
      .single()

    if (error || !session) {
      console.error("[voice/sessions] insert failed", { userId: user.id, scopeId, error: error?.message ?? "No row returned" })
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
    }

    // Auto-join the creator as a participant
    const { error: participantError } = await supabase
      .from("voice_call_participants")
      .upsert(
        {
          session_id: session.id,
          user_id: user.id,
          consent_transcription: false,
          consent_translation: false,
        },
        { onConflict: "session_id,user_id" }
      )

    if (participantError) {
      console.error("[voice/sessions] participant upsert failed", { sessionId: session.id, userId: user.id, error: participantError.message })
      // Session was created — return it even if participant join failed
    }

    return NextResponse.json({ session }, { status: 201 })
  } catch (err) {
    console.error("[voice/sessions] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
