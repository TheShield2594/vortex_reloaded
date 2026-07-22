import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { SubtitlePreferencesRequest } from "@/types/vortex-recap"

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/voice/sessions/{id}/subtitle-preferences
 *
 * Update the preferred subtitle language for the authenticated participant
 * without changing their transcription/translation consent.
 *
 * Idempotency: identical preference updates are no-ops (200).
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

  let body: SubtitlePreferencesRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { preferredSubtitleLanguage } = body

  // Participant must already exist
  const { data: existing } = await supabase
    .from("voice_call_participants")
    .select("id, preferred_subtitle_language")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: "Participant not found in session" }, { status: 404 })
  }

  if (existing.preferred_subtitle_language === preferredSubtitleLanguage) {
    return NextResponse.json({ participant: existing }, { status: 200 })
  }

  const { data: participant, error } = await supabase
    .from("voice_call_participants")
    .update({ preferred_subtitle_language: preferredSubtitleLanguage ?? null })
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 })
  }

  return NextResponse.json({ participant }, { status: 200 })
}
