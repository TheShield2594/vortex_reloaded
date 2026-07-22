// TypeScript types for the voice intelligence feature.
// These mirror the database schema defined in 00047_voice_intelligence.sql.

export type VoiceScopeType = "server_channel" | "dm_call"
export type VoiceTranscriptionMode = "off" | "manual_opt_in" | "server_policy_required"
export type VoiceSummaryStatus = "pending" | "ready" | "failed" | "skipped"
export type VoicePolicyScopeType = "workspace" | "server"

// ── Database row types ────────────────────────────────────────────────────────

export interface VoiceCallSessionRow {
  id: string
  scope_type: VoiceScopeType
  scope_id: string
  started_at: string
  ended_at: string | null
  started_by: string
  transcription_mode: VoiceTranscriptionMode
  summary_status: VoiceSummaryStatus
  created_at: string
}

export interface VoiceCallParticipantRow {
  id: string
  session_id: string
  user_id: string
  joined_at: string
  left_at: string | null
  consent_transcription: boolean
  consent_translation: boolean
  preferred_subtitle_language: string | null
}

export interface VoiceTranscriptSegmentRow {
  id: string
  session_id: string
  speaker_user_id: string | null
  source_language: string
  text: string
  started_at: string
  ended_at: string
  confidence: number | null
  provider: string | null
  is_redacted: boolean
  expires_at: string | null
  deleted_at: string | null
  purged_at: string | null
  legal_hold: boolean
  legal_hold_reason: string | null
  created_at: string
}

export interface VoiceTranscriptTranslationRow {
  id: string
  segment_id: string
  target_user_id: string | null
  target_language: string
  translated_text: string
  provider: string | null
  created_at: string
}

export interface VoiceCallSummaryRow {
  session_id: string
  model: string
  highlights_md: string
  decisions_md: string
  action_items_md: string
  generated_at: string
  quality_score: number | null
  expires_at: string | null
  deleted_at: string | null
  purged_at: string | null
  legal_hold: boolean
  legal_hold_reason: string | null
}

export interface VortexRecapPolicyRow {
  id: string
  scope_type: VoicePolicyScopeType
  scope_id: string
  transcription_enabled: boolean
  require_explicit_consent: boolean
  translation_enabled: boolean
  summary_enabled: boolean
  retention_days: number
  allowed_locales: string[]
  created_at: string
  updated_at: string
}

export interface VortexRecapAuditLogRow {
  id: string
  session_id: string | null
  actor_user_id: string | null
  event_type: string
  payload_json: Record<string, unknown>
  created_at: string
}

// ── Resolved / computed types ─────────────────────────────────────────────────

/** The effective policy for a call, resolved from workspace + server layers. */
export interface EffectiveVoicePolicy {
  transcriptionEnabled: boolean
  requireExplicitConsent: boolean
  translationEnabled: boolean
  summaryEnabled: boolean
  retentionDays: number
  allowedLocales: string[]
}

/** In-memory interim transcript event (not persisted). */
export interface InterimTranscriptSegment {
  speakerUserId: string | null
  text: string
  sourceLanguage: string
  startedAt: Date
}

/** Final transcript segment, ready to persist. */
export interface FinalTranscriptSegment {
  speakerUserId: string | null
  text: string
  sourceLanguage: string
  startedAt: Date
  endedAt: Date
  confidence: number | null
  provider: string
}

/** Per-participant consent state held in client memory. */
export interface ParticipantConsentState {
  userId: string
  consentTranscription: boolean
  consentTranslation: boolean
  preferredSubtitleLanguage: string | null
}

/** Structured post-call summary sections. */
export interface VoiceCallSummarySections {
  highlights: string
  decisions: string
  actionItems: string
}

// ── API request/response shapes ───────────────────────────────────────────────

export interface StartSessionRequest {
  scopeType: VoiceScopeType
  scopeId: string
  transcriptionMode: VoiceTranscriptionMode
}

export interface StartSessionResponse {
  session: VoiceCallSessionRow
}

export interface ConsentRequest {
  consentTranscription: boolean
  consentTranslation: boolean
  preferredSubtitleLanguage?: string | null
}

export interface SubtitlePreferencesRequest {
  preferredSubtitleLanguage: string | null
}

export interface EndSessionRequest {
  /** ISO timestamp of when the call ended, provided by the client. */
  endedAt?: string
}

export interface PolicyUpdateRequest {
  transcriptionEnabled?: boolean
  requireExplicitConsent?: boolean
  translationEnabled?: boolean
  summaryEnabled?: boolean
  retentionDays?: number
  allowedLocales?: string[]
}
