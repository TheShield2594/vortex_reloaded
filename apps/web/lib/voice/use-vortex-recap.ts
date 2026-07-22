"use client"

// Main hook for voice intelligence: session lifecycle, consent orchestration,
// and live transcription. Designed to be used alongside the existing use-voice
// and use-livekit-voice hooks without modifying them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { createSTTProvider, type STTProvider, type STTSegment } from "@/lib/voice/stt-provider"
import {
  makeTranscriptionStatusChangedEvent,
  makeTranscriptSegmentInterimEvent,
  makeTranscriptSegmentFinalEvent,
  makeConsentChangedEvent,
  VOICE_EVENT,
  type VortexRecapEvent,
  type TranscriptSegmentFinalEvent,
  type TranscriptSegmentInterimEvent,
  type SummaryReadyEvent,
  type ConsentChangedEvent,
} from "@/lib/voice/vortex-recap-events"
import type {
  EffectiveVoicePolicy,
  InterimTranscriptSegment,
  VoiceTranscriptSegmentRow,
  VoiceCallSessionRow,
  ParticipantConsentState,
} from "@/types/vortex-recap"

export type TranscriptionStatus = "inactive" | "active" | "error"

export interface VortexRecapState {
  /** The active session, null when not in a call. */
  session: VoiceCallSessionRow | null
  /** Effective policy resolved from workspace + server layers. */
  policy: EffectiveVoicePolicy | null
  /** Current user's consent state. */
  myConsent: ParticipantConsentState | null
  /** All participants' consent states, keyed by user_id. */
  participantConsents: Map<string, ParticipantConsentState>
  /** Current transcription pipeline status. */
  transcriptionStatus: TranscriptionStatus
  /** In-memory interim transcript (not yet final). */
  interimSegment: InterimTranscriptSegment | null
  /** Finalized transcript segments received over realtime. */
  finalSegments: VoiceTranscriptSegmentRow[]
  /** True while the post-call summary is being generated. */
  summaryPending: boolean
}

export interface UseVortexRecapReturn extends VortexRecapState {
  /** Start a voice intelligence session. Call after joining a voice channel/DM call. */
  startSession: (args: {
    scopeType: "server_channel" | "dm_call"
    scopeId: string
    localStream: MediaStream | null
    language?: string
  }) => Promise<void>
  /** Record the current user's consent decision and broadcast it to the session channel. */
  setConsent: (consentTranscription: boolean, consentTranslation: boolean, language?: string | null) => Promise<void>
  /** Update the preferred subtitle language without changing transcription consent. */
  setSubtitleLanguage: (language: string | null) => Promise<void>
  /** End the session (call when the user leaves or hangs up). */
  endSession: () => Promise<void>
}

export function useVortexRecap(userId: string | null): UseVortexRecapReturn {
  const supabase = useMemo(() => createClientSupabaseClient(), [])

  const [session, setSession] = useState<VoiceCallSessionRow | null>(null)
  const [policy, setPolicy] = useState<EffectiveVoicePolicy | null>(null)
  const [myConsent, setMyConsent] = useState<ParticipantConsentState | null>(null)
  const [participantConsents, setParticipantConsents] = useState<Map<string, ParticipantConsentState>>(new Map())
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus>("inactive")
  const [interimSegment, setInterimSegment] = useState<InterimTranscriptSegment | null>(null)
  const [finalSegments, setFinalSegments] = useState<VoiceTranscriptSegmentRow[]>([])
  const [summaryPending, setSummaryPending] = useState(false)

  const sessionRef = useRef<VoiceCallSessionRow | null>(null)
  const sttRef = useRef<STTProvider | null>(null)
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  sessionRef.current = session

  // ── Realtime subscription ──────────────────────────────────────────────────

  const subscribeToSession = useCallback(
    (sessionId: string) => {
      const ch = supabase.channel(`voice-intelligence:${sessionId}`)

      ch.on<VortexRecapEvent>(
        "broadcast",
        { event: VOICE_EVENT.TRANSCRIPT_SEGMENT_INTERIM },
        ({ payload }) => {
          const e = payload as TranscriptSegmentInterimEvent
          setInterimSegment({
            speakerUserId: e.speaker_user_id,
            text: e.text,
            sourceLanguage: e.source_language,
            startedAt: new Date(e.started_at),
          })
        }
      )
        .on<VortexRecapEvent>(
          "broadcast",
          { event: VOICE_EVENT.TRANSCRIPT_SEGMENT_FINAL },
          ({ payload }) => {
            const e = payload as TranscriptSegmentFinalEvent
            setInterimSegment(null)
            setFinalSegments((prev) => [
              ...prev,
              {
                id: e.segment_id,
                session_id: e.session_id,
                speaker_user_id: e.speaker_user_id,
                source_language: e.source_language,
                text: e.text,
                started_at: e.started_at,
                ended_at: e.ended_at,
                confidence: e.confidence,
                provider: e.provider,
                is_redacted: false,
                expires_at: null,
                deleted_at: null,
                purged_at: null,
                legal_hold: false,
                legal_hold_reason: null,
                created_at: e.occurred_at,
              },
            ])
          }
        )
        .on<VortexRecapEvent>(
          "broadcast",
          { event: VOICE_EVENT.SUMMARY_READY },
          ({ payload }) => {
            void payload
            setSummaryPending(false)
          }
        )
        .on<VortexRecapEvent>(
          "broadcast",
          { event: VOICE_EVENT.CONSENT_CHANGED },
          ({ payload }) => {
            const e = payload as ConsentChangedEvent
            setParticipantConsents((prev) => {
              const next = new Map(prev)
              next.set(e.user_id, {
                userId: e.user_id,
                consentTranscription: e.consent_transcription,
                consentTranslation: e.consent_translation,
                preferredSubtitleLanguage: e.preferred_subtitle_language,
              })
              return next
            })
          }
        )
        .subscribe()

      realtimeChannelRef.current = ch
    },
    [supabase]
  )

  // ── STT pipeline ───────────────────────────────────────────────────────────

  const startSTTPipeline = useCallback(
    (sessionId: string, stream: MediaStream, language: string) => {
      const provider = createSTTProvider()
      if (!provider) {
        setTranscriptionStatus("error")
        return
      }

      sttRef.current = provider

      provider.onSegment = (segment: STTSegment) => {
        if (!userId) return

        const ch = realtimeChannelRef.current
        if (!ch) return

        if (!segment.isFinal) {
          const event = makeTranscriptSegmentInterimEvent(
            sessionId,
            userId,
            segment.text,
            language,
            segment.startedAt.toISOString()
          )
          ch.send({ type: "broadcast", event: VOICE_EVENT.TRANSCRIPT_SEGMENT_INTERIM, payload: event })
          setInterimSegment({
            speakerUserId: userId,
            text: segment.text,
            sourceLanguage: language,
            startedAt: segment.startedAt,
          })
        } else {
          // Persist final segment via API
          const body = {
            session_id: sessionId,
            speaker_user_id: userId,
            source_language: language,
            text: segment.text,
            started_at: segment.startedAt.toISOString(),
            ended_at: segment.endedAt.toISOString(),
            confidence: segment.confidence,
            provider: "web-speech-api",
          }

          fetch(`/api/voice/sessions/${sessionId}/transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
            .then((res) => res.json())
            .then((data: { segment?: VoiceTranscriptSegmentRow }) => {
              if (data.segment) {
                const saved = data.segment
                const event = makeTranscriptSegmentFinalEvent(
                  sessionId,
                  saved.id,
                  saved.speaker_user_id,
                  saved.text,
                  saved.source_language,
                  saved.started_at,
                  saved.ended_at,
                  saved.confidence,
                  saved.provider ?? "web-speech-api"
                )
                ch.send({ type: "broadcast", event: VOICE_EVENT.TRANSCRIPT_SEGMENT_FINAL, payload: event })
              }
            })
            .catch(() => {
              // Non-fatal: segment is already visible locally
            })
        }
      }

      provider.onError = () => {
        setTranscriptionStatus("error")
      }

      provider.onEnd = () => {
        setTranscriptionStatus("inactive")
      }

      provider.start(stream, language)
      setTranscriptionStatus("active")

      // Broadcast transcription active status
      const ch = realtimeChannelRef.current
      if (ch) {
        const statusEvent = makeTranscriptionStatusChangedEvent(sessionId, true, "manual_opt_in")
        ch.send({ type: "broadcast", event: VOICE_EVENT.TRANSCRIPTION_STATUS_CHANGED, payload: statusEvent })
      }
    },
    [userId]
  )

  const stopSTTPipeline = useCallback(
    (sessionId: string) => {
      sttRef.current?.stop()
      sttRef.current = null
      setTranscriptionStatus("inactive")
      setInterimSegment(null)

      const ch = realtimeChannelRef.current
      if (ch) {
        const statusEvent = makeTranscriptionStatusChangedEvent(sessionId, false, "off")
        ch.send({ type: "broadcast", event: VOICE_EVENT.TRANSCRIPTION_STATUS_CHANGED, payload: statusEvent })
      }
    },
    []
  )

  // ── Public API ─────────────────────────────────────────────────────────────

  const startSession = useCallback(
    async ({
      scopeType,
      scopeId,
      localStream,
      language = "en-US",
    }: {
      scopeType: "server_channel" | "dm_call"
      scopeId: string
      localStream: MediaStream | null
      language?: string
    }) => {
      if (!userId) return

      // Fetch effective policy for the scope
      let fetchedPolicy: EffectiveVoicePolicy | null = null
      if (scopeType === "server_channel") {
        try {
          const res = await fetch(`/api/servers/${scopeId.split(":")[0]}/voice-intelligence-policy`)
          if (res.ok) {
            fetchedPolicy = (await res.json()) as EffectiveVoicePolicy
          }
        } catch {
          // Use default policy on fetch failure
        }
      }
      setPolicy(fetchedPolicy)

      // Create session
      const res = await fetch("/api/voice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeId,
          transcriptionMode:
            fetchedPolicy?.transcriptionEnabled ? "manual_opt_in" : "off",
        }),
      })

      if (!res.ok) return

      const data = (await res.json()) as { session: VoiceCallSessionRow }
      const newSession = data.session
      setSession(newSession)
      setFinalSegments([])
      setSummaryPending(false)

      subscribeToSession(newSession.id)

      // If transcription is enabled and user has already consented (no explicit
      // consent required by policy), start the pipeline immediately.
      if (fetchedPolicy && !fetchedPolicy.requireExplicitConsent && fetchedPolicy.transcriptionEnabled && localStream) {
        await fetch(`/api/voice/sessions/${newSession.id}/consent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consentTranscription: true, consentTranslation: false }),
        })
        setMyConsent({
          userId,
          consentTranscription: true,
          consentTranslation: false,
          preferredSubtitleLanguage: null,
        })
        startSTTPipeline(newSession.id, localStream, language)
      }
    },
    [userId, subscribeToSession, startSTTPipeline]
  )

  const setConsent = useCallback(
    async (
      consentTranscription: boolean,
      consentTranslation: boolean,
      language: string | null = null
    ) => {
      const s = sessionRef.current
      if (!s || !userId) return

      await fetch(`/api/voice/sessions/${s.id}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentTranscription, consentTranslation, preferredSubtitleLanguage: language }),
      })

      const newConsent: ParticipantConsentState = {
        userId,
        consentTranscription,
        consentTranslation,
        preferredSubtitleLanguage: language,
      }
      setMyConsent(newConsent)

      // Broadcast consent change to other participants
      const ch = realtimeChannelRef.current
      if (ch) {
        const event = makeConsentChangedEvent(s.id, userId, consentTranscription, consentTranslation, language)
        ch.send({ type: "broadcast", event: VOICE_EVENT.CONSENT_CHANGED, payload: event })
      }

      // Start or stop STT based on new consent
      if (consentTranscription && transcriptionStatus === "inactive") {
        // We don't have the stream here — the caller must provide it via startSession
        // or the UI must re-call startSession. This path handles toggle-from-UI.
      } else if (!consentTranscription && transcriptionStatus === "active") {
        stopSTTPipeline(s.id)
      }
    },
    [userId, transcriptionStatus, stopSTTPipeline]
  )

  const setSubtitleLanguage = useCallback(async (language: string | null) => {
    const s = sessionRef.current
    if (!s) return

    await fetch(`/api/voice/sessions/${s.id}/subtitle-preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredSubtitleLanguage: language }),
    })

    setMyConsent((prev) =>
      prev ? { ...prev, preferredSubtitleLanguage: language } : prev
    )
  }, [])

  const endSession = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return

    stopSTTPipeline(s.id)

    await fetch(`/api/voice/sessions/${s.id}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })

    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current)
      realtimeChannelRef.current = null
    }

    setSummaryPending(policy?.summaryEnabled ?? false)
    setSession(null)
    setMyConsent(null)
    setParticipantConsents(new Map())
    setInterimSegment(null)
  }, [stopSTTPipeline, supabase, policy])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sttRef.current?.stop()
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current)
      }
    }
  }, [supabase])

  return {
    session,
    policy,
    myConsent,
    participantConsents,
    transcriptionStatus,
    interimSegment,
    finalSegments,
    summaryPending,
    startSession,
    setConsent,
    setSubtitleLanguage,
    endSession,
  }
}
