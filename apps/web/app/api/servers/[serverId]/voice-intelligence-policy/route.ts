import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { requireServerOwner } from "@/lib/server-auth"
import { resolveEffectivePolicy } from "@/lib/voice/vortex-recap-service"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { PolicyUpdateRequest } from "@/types/vortex-recap"
import type { Database } from "@/types/database"

type PolicyInsert = Database["public"]["Tables"]["voice_intelligence_policies"]["Insert"]

type Params = { params: Promise<{ serverId: string }> }

/**
 * GET /api/servers/{serverId}/voice-intelligence-policy
 *
 * Return the effective voice intelligence policy for a server.
 * Any authenticated member can read (used by client hook at session start).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { serverId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const effectivePolicy = await resolveEffectivePolicy(supabase, serverId)
    return NextResponse.json(effectivePolicy)

  } catch (err) {
    console.error("[servers/[serverId]/voice-intelligence-policy GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/servers/{serverId}/voice-intelligence-policy
 *
 * Create or update the voice intelligence policy for a server.
 * Idempotency: accepts X-Idempotency-Key; conflicting optimistic-lock
 * version returns 409. Replay with same key returns original revision (200).
 *
 * Required scope: voice:policy:write (server owner only).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { serverId } = await params
  const { supabase: _supabase, user, error: authError } = await requireServerOwner(serverId)
  if (authError) return authError

  let body: PolicyUpdateRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const serviceClient = await createServiceRoleClient()

  const updatePayload: PolicyInsert = { scope_type: "server", scope_id: serverId }
  if (body.transcriptionEnabled !== undefined)
    updatePayload.transcription_enabled = body.transcriptionEnabled
  if (body.requireExplicitConsent !== undefined)
    updatePayload.require_explicit_consent = body.requireExplicitConsent
  if (body.translationEnabled !== undefined)
    updatePayload.translation_enabled = body.translationEnabled
  if (body.summaryEnabled !== undefined)
    updatePayload.summary_enabled = body.summaryEnabled
  if (body.retentionDays !== undefined) {
    if (body.retentionDays < 1 || body.retentionDays > 365) {
      return NextResponse.json({ error: "retentionDays must be between 1 and 365" }, { status: 400 })
    }
    updatePayload.retention_days = body.retentionDays
  }
  if (body.allowedLocales !== undefined) updatePayload.allowed_locales = body.allowedLocales

  const { data: policy, error } = await serviceClient
    .from("voice_intelligence_policies")
    .upsert(updatePayload, { onConflict: "scope_type,scope_id" })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: "Failed to update voice intelligence policy" }, { status: 500 })
  }

  return NextResponse.json({ policy })
}
