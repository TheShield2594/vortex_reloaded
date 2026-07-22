import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { ConsentRequest } from "@/types/vortex-recap"

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/voice/sessions/{id}/consent
 *
 * Record or update the authenticated user's consent for transcription and
 * translation in this session. Creates a participant row if one does not exist
 * (e.g. participant joined after the session was created).
 *
 * Idempotency: identical payloads are a no-op (200). Consent can be changed
 * mid-call; the pipeline is expected to be started/stopped by the client hook.
 *
 * Required scopes: voice:sessions:modify + voice:consent (implied by auth + participation).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id: sessionId } = await params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: ConsentRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { consentTranscription, consentTranslation, preferredSubtitleLanguage = null } = body

  if (typeof consentTranscription !== "boolean" || typeof consentTranslation !== "boolean") {
    return NextResponse.json(
      { error: "consentTranscription and consentTranslation must be booleans" },
      { status: 400 }
    )
  }

  // Verify session exists and is active
  const { data: session } = await supabase
    .from("voice_call_sessions")
    .select("id, ended_at")
    .eq("id", sessionId)
    .maybeSingle()

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }
  if (session.ended_at) {
    return NextResponse.json({ error: "Session has already ended" }, { status: 409 })
  }

  // Upsert participant with new consent state
  const { data: participant, error } = await supabase
    .from("voice_call_participants")
    .upsert(
      {
        session_id: sessionId,
        user_id: user.id,
        consent_transcription: consentTranscription,
        consent_translation: consentTranslation,
        preferred_subtitle_language: preferredSubtitleLanguage ?? null,
      },
      { onConflict: "session_id,user_id" }
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: "Failed to update consent" }, { status: 500 })
  }

  return NextResponse.json({ participant }, { status: 200 })
}
