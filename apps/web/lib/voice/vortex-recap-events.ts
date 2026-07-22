// Realtime event contract for voice intelligence.
// All events use a versioned envelope so consumers can branch on schema_version.
// Compatibility rules:
//   - Additive field additions are allowed in minor/patch bumps.
//   - Field removal/rename requires a deprecation window (>=2 minor releases or 90 days).
//   - Clients MUST ignore unknown fields.
//   - Producers MUST NOT change the semantic meaning of existing fields without a version bump.

export const VORTEX_RECAP_SCHEMA_VERSION = "1.0.0"

// ── Event name constants ──────────────────────────────────────────────────────

export const VOICE_EVENT = {
  TRANSCRIPTION_STATUS_CHANGED: "voice.transcription.status.changed",
  TRANSCRIPT_SEGMENT_INTERIM: "voice.transcript.segment.interim",
  TRANSCRIPT_SEGMENT_FINAL: "voice.transcript.segment.final",
  TRANSCRIPT_TRANSLATION_FINAL: "voice.transcript.translation.final",
  SUMMARY_READY: "voice.summary.ready",
  CONSENT_CHANGED: "voice.consent.changed",
} as const

export type VoiceEventName = (typeof VOICE_EVENT)[keyof typeof VOICE_EVENT]

// ── Shared envelope ───────────────────────────────────────────────────────────

interface EventEnvelope {
  event_name: VoiceEventName
  schema_version: string
  event_id: string
  occurred_at: string
  session_id: string
}

// ── Typed event payloads ──────────────────────────────────────────────────────

export interface TranscriptionStatusChangedEvent extends EventEnvelope {
  event_name: typeof VOICE_EVENT.TRANSCRIPTION_STATUS_CHANGED
  active: boolean
  transcription_mode: "off" | "manual_opt_in" | "server_policy_required"
}

export interface TranscriptSegmentInterimEvent extends EventEnvelope {
  event_name: typeof VOICE_EVENT.TRANSCRIPT_SEGMENT_INTERIM
  speaker_user_id: string | null
  text: string
  source_language: string
  started_at: string
}

export interface TranscriptSegmentFinalEvent extends EventEnvelope {
  event_name: typeof VOICE_EVENT.TRANSCRIPT_SEGMENT_FINAL
  segment_id: string
  speaker_user_id: string | null
  text: string
  source_language: string
  started_at: string
  ended_at: string
  confidence: number | null
  provider: string
}

export interface TranscriptTranslationFinalEvent extends EventEnvelope {
  event_name: typeof VOICE_EVENT.TRANSCRIPT_TRANSLATION_FINAL
  segment_id: string
  translation_id: string
  target_user_id: string
  target_language: string
  translated_text: string
  provider: string
}

export interface SummaryReadyEvent extends EventEnvelope {
  event_name: typeof VOICE_EVENT.SUMMARY_READY
  model: string
  generated_at: string
}

export interface ConsentChangedEvent extends EventEnvelope {
  event_name: typeof VOICE_EVENT.CONSENT_CHANGED
  user_id: string
  consent_transcription: boolean
  consent_translation: boolean
  preferred_subtitle_language: string | null
}

export type VortexRecapEvent =
  | TranscriptionStatusChangedEvent
  | TranscriptSegmentInterimEvent
  | TranscriptSegmentFinalEvent
  | TranscriptTranslationFinalEvent
  | SummaryReadyEvent
  | ConsentChangedEvent

// ── Factory helpers ───────────────────────────────────────────────────────────

function baseEnvelope(eventName: VoiceEventName, sessionId: string): EventEnvelope {
  return {
    event_name: eventName,
    schema_version: VORTEX_RECAP_SCHEMA_VERSION,
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
  }
}

export function makeTranscriptionStatusChangedEvent(
  sessionId: string,
  active: boolean,
  transcriptionMode: TranscriptionStatusChangedEvent["transcription_mode"]
): TranscriptionStatusChangedEvent {
  return {
    ...baseEnvelope(VOICE_EVENT.TRANSCRIPTION_STATUS_CHANGED, sessionId),
    event_name: VOICE_EVENT.TRANSCRIPTION_STATUS_CHANGED,
    active,
    transcription_mode: transcriptionMode,
  }
}

export function makeTranscriptSegmentInterimEvent(
  sessionId: string,
  speakerUserId: string | null,
  text: string,
  sourceLanguage: string,
  startedAt: string
): TranscriptSegmentInterimEvent {
  return {
    ...baseEnvelope(VOICE_EVENT.TRANSCRIPT_SEGMENT_INTERIM, sessionId),
    event_name: VOICE_EVENT.TRANSCRIPT_SEGMENT_INTERIM,
    speaker_user_id: speakerUserId,
    text,
    source_language: sourceLanguage,
    started_at: startedAt,
  }
}

export function makeTranscriptSegmentFinalEvent(
  sessionId: string,
  segmentId: string,
  speakerUserId: string | null,
  text: string,
  sourceLanguage: string,
  startedAt: string,
  endedAt: string,
  confidence: number | null,
  provider: string
): TranscriptSegmentFinalEvent {
  return {
    ...baseEnvelope(VOICE_EVENT.TRANSCRIPT_SEGMENT_FINAL, sessionId),
    event_name: VOICE_EVENT.TRANSCRIPT_SEGMENT_FINAL,
    segment_id: segmentId,
    speaker_user_id: speakerUserId,
    text,
    source_language: sourceLanguage,
    started_at: startedAt,
    ended_at: endedAt,
    confidence,
    provider,
  }
}

export function makeConsentChangedEvent(
  sessionId: string,
  userId: string,
  consentTranscription: boolean,
  consentTranslation: boolean,
  preferredSubtitleLanguage: string | null
): ConsentChangedEvent {
  return {
    ...baseEnvelope(VOICE_EVENT.CONSENT_CHANGED, sessionId),
    event_name: VOICE_EVENT.CONSENT_CHANGED,
    user_id: userId,
    consent_transcription: consentTranscription,
    consent_translation: consentTranslation,
    preferred_subtitle_language: preferredSubtitleLanguage,
  }
}

export function makeSummaryReadyEvent(
  sessionId: string,
  model: string,
  generatedAt: string
): SummaryReadyEvent {
  return {
    ...baseEnvelope(VOICE_EVENT.SUMMARY_READY, sessionId),
    event_name: VOICE_EVENT.SUMMARY_READY,
    model,
    generated_at: generatedAt,
  }
}
