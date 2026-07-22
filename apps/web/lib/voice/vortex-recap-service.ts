// Server-side service utilities for voice intelligence.
// Used by API route handlers. All DB access goes through a Supabase client
// that is passed in (anon key for user-scoped ops, service role for admin/cron).

import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  EffectiveVoicePolicy,
  VortexRecapPolicyRow,
  VoiceCallSummarySections,
} from "@/types/vortex-recap"
import { resolveAdapter } from "@/lib/ai/ai-router"

// ── Default policy (global fallback) ─────────────────────────────────────────

const DEFAULT_POLICY: EffectiveVoicePolicy = {
  transcriptionEnabled: false,
  requireExplicitConsent: true,
  translationEnabled: false,
  summaryEnabled: false,
  retentionDays: 30,
  allowedLocales: [],
}

function policyRowToEffective(row: VortexRecapPolicyRow): EffectiveVoicePolicy {
  return {
    transcriptionEnabled: row.transcription_enabled,
    requireExplicitConsent: row.require_explicit_consent,
    translationEnabled: row.translation_enabled,
    summaryEnabled: row.summary_enabled,
    retentionDays: row.retention_days,
    allowedLocales: row.allowed_locales,
  }
}

/**
 * Resolve the effective voice intelligence policy for a server.
 * Precedence: global default → workspace policy → server policy.
 * More-specific scopes override less-specific ones field-by-field.
 */
export async function resolveEffectivePolicy(
  supabase: SupabaseClient,
  serverId: string
): Promise<EffectiveVoicePolicy> {
  const { data: rows } = await supabase
    .from("voice_intelligence_policies")
    .select("*")
    .in("scope_type", ["workspace", "server"])
    .in("scope_id", [serverId, "global"])

  if (!rows || rows.length === 0) return { ...DEFAULT_POLICY }

  let effective: EffectiveVoicePolicy = { ...DEFAULT_POLICY }

  // Apply workspace policy first, then server policy (most specific wins)
  const workspaceRow = (rows as VortexRecapPolicyRow[]).find(
    (r) => r.scope_type === "workspace"
  )
  const serverRow = (rows as VortexRecapPolicyRow[]).find(
    (r) => r.scope_type === "server" && r.scope_id === serverId
  )

  if (workspaceRow) effective = { ...effective, ...policyRowToEffective(workspaceRow) }
  if (serverRow) effective = { ...effective, ...policyRowToEffective(serverRow) }

  return effective
}

// ── Retention helpers ─────────────────────────────────────────────────────────

/** Compute the expires_at timestamp for a new transcript/summary record. */
export function computeExpiresAt(retentionDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + retentionDays)
  return d.toISOString()
}

// ── Audit logging ─────────────────────────────────────────────────────────────

/** Write an immutable audit event. Uses service-role client to bypass RLS. */
export async function writeAuditEvent(
  serviceClient: SupabaseClient,
  sessionId: string | null,
  actorUserId: string | null,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  await serviceClient.from("voice_intelligence_audit_log").insert({
    session_id: sessionId,
    actor_user_id: actorUserId,
    event_type: eventType,
    payload_json: payload,
  })
}

// ── Summary generation (multi-provider) ──────────────────────────────────────

/**
 * Generate a structured post-call summary from assembled transcript text.
 *
 * Uses the server's configured AI provider for the `voice_summary` function.
 * Falls back through: per-function routing → default provider → legacy Gemini key.
 *
 * Returns null when no provider is configured or the call fails, so the worker
 * can mark summary_status = 'failed' and retry later.
 */
export async function generateVoiceCallSummary(
  supabase: SupabaseClient,
  serverId: string,
  transcriptText: string
): Promise<VoiceCallSummarySections | null> {
  const adapter = await resolveAdapter(supabase, serverId, "voice_summary")
  if (!adapter) return null

  try {
    const result = await adapter.complete(
      [
        {
          role: "system",
          content: `You are an assistant that summarizes voice call transcripts.
Return your response as JSON with this exact shape:
{
  "highlights": "markdown prose — key highlights from the call",
  "decisions": "markdown prose — decisions reached during the call",
  "action_items": "markdown prose — concrete action items with owners where mentioned"
}
Be concise and factual. Use only information from the transcript.`,
        },
        {
          role: "user",
          content: `Summarize this voice call transcript:\n\n${transcriptText}`,
        },
      ],
      { maxTokens: 1024, jsonMode: true }
    )

    const parsed = JSON.parse(result.text) as {
      highlights?: string
      decisions?: string
      action_items?: string
    }

    return {
      highlights: parsed.highlights ?? "",
      decisions: parsed.decisions ?? "",
      actionItems: parsed.action_items ?? "",
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[generateVoiceCallSummary] failed to generate summary", {
      serverId,
      error: message,
    })
    return null
  }
}

// ── Transcript assembler ──────────────────────────────────────────────────────

/** Join transcript segments into a plain-text string suitable for summarization. */
export function assembleTranscriptText(
  segments: Array<{ speaker_user_id: string | null; text: string; started_at: string }>
): string {
  return segments
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    .map((s) => `[${s.speaker_user_id ?? "unknown"}]: ${s.text}`)
    .join("\n")
}

// ── Minimum transcript threshold ──────────────────────────────────────────────

/** Minimum number of final segments required before summary generation runs. */
export const SUMMARY_MIN_SEGMENT_COUNT = 3
