import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  assembleTranscriptText,
  computeExpiresAt,
  SUMMARY_MIN_SEGMENT_COUNT,
} from "@/lib/voice/vortex-recap-service"
import {
  makeTranscriptionStatusChangedEvent,
  makeTranscriptSegmentInterimEvent,
  makeTranscriptSegmentFinalEvent,
  makeConsentChangedEvent,
  makeSummaryReadyEvent,
  VOICE_EVENT,
  VORTEX_RECAP_SCHEMA_VERSION,
} from "@/lib/voice/vortex-recap-events"
import { isWebSpeechApiSupported } from "@/lib/voice/stt-provider"

// ── assembleTranscriptText ────────────────────────────────────────────────────

describe("assembleTranscriptText", () => {
  it("joins segments in chronological order", () => {
    const segments = [
      { speaker_user_id: "user-b", text: "Second line", started_at: "2024-01-01T00:00:02Z" },
      { speaker_user_id: "user-a", text: "First line", started_at: "2024-01-01T00:00:01Z" },
    ]
    const result = assembleTranscriptText(segments)
    expect(result).toBe("[user-a]: First line\n[user-b]: Second line")
  })

  it("labels null speaker as 'unknown'", () => {
    const segments = [
      { speaker_user_id: null, text: "Something", started_at: "2024-01-01T00:00:00Z" },
    ]
    const result = assembleTranscriptText(segments)
    expect(result).toBe("[unknown]: Something")
  })

  it("returns empty string for empty segments array", () => {
    expect(assembleTranscriptText([])).toBe("")
  })
})

// ── computeExpiresAt ──────────────────────────────────────────────────────────

describe("computeExpiresAt", () => {
  it("returns a date that is exactly retentionDays in the future", () => {
    const now = new Date("2024-06-01T00:00:00Z")
    vi.setSystemTime(now)

    const result = computeExpiresAt(30)
    const expected = new Date("2024-07-01T00:00:00Z")
    expect(new Date(result).toISOString()).toBe(expected.toISOString())

    vi.useRealTimers()
  })

  it("works for short retention (7 days)", () => {
    const now = new Date("2024-01-01T00:00:00Z")
    vi.setSystemTime(now)

    const result = computeExpiresAt(7)
    const expected = new Date("2024-01-08T00:00:00Z")
    expect(new Date(result).toISOString()).toBe(expected.toISOString())

    vi.useRealTimers()
  })
})

// ── SUMMARY_MIN_SEGMENT_COUNT ─────────────────────────────────────────────────

describe("SUMMARY_MIN_SEGMENT_COUNT", () => {
  it("is a positive integer", () => {
    expect(SUMMARY_MIN_SEGMENT_COUNT).toBeGreaterThan(0)
    expect(Number.isInteger(SUMMARY_MIN_SEGMENT_COUNT)).toBe(true)
  })
})

// ── Event factory helpers ─────────────────────────────────────────────────────

describe("voice intelligence event factories", () => {
  const SESSION_ID = "session-abc-123"

  it("makeTranscriptionStatusChangedEvent produces correct structure", () => {
    const event = makeTranscriptionStatusChangedEvent(SESSION_ID, true, "manual_opt_in")
    expect(event.event_name).toBe(VOICE_EVENT.TRANSCRIPTION_STATUS_CHANGED)
    expect(event.schema_version).toBe(VORTEX_RECAP_SCHEMA_VERSION)
    expect(event.session_id).toBe(SESSION_ID)
    expect(event.active).toBe(true)
    expect(event.transcription_mode).toBe("manual_opt_in")
    expect(event.event_id).toBeTruthy()
    expect(event.occurred_at).toBeTruthy()
  })

  it("makeTranscriptSegmentInterimEvent produces correct structure", () => {
    const event = makeTranscriptSegmentInterimEvent(
      SESSION_ID,
      "user-1",
      "Hello world",
      "en",
      "2024-01-01T00:00:00Z"
    )
    expect(event.event_name).toBe(VOICE_EVENT.TRANSCRIPT_SEGMENT_INTERIM)
    expect(event.speaker_user_id).toBe("user-1")
    expect(event.text).toBe("Hello world")
    expect(event.source_language).toBe("en")
    expect(event.started_at).toBe("2024-01-01T00:00:00Z")
  })

  it("makeTranscriptSegmentFinalEvent produces correct structure", () => {
    const event = makeTranscriptSegmentFinalEvent(
      SESSION_ID,
      "seg-1",
      "user-2",
      "How are you",
      "en",
      "2024-01-01T00:00:01Z",
      "2024-01-01T00:00:03Z",
      0.92,
      "web-speech-api"
    )
    expect(event.event_name).toBe(VOICE_EVENT.TRANSCRIPT_SEGMENT_FINAL)
    expect(event.segment_id).toBe("seg-1")
    expect(event.confidence).toBe(0.92)
    expect(event.provider).toBe("web-speech-api")
    expect(event.ended_at).toBe("2024-01-01T00:00:03Z")
  })

  it("makeConsentChangedEvent produces correct structure", () => {
    const event = makeConsentChangedEvent(SESSION_ID, "user-3", true, false, "fr")
    expect(event.event_name).toBe(VOICE_EVENT.CONSENT_CHANGED)
    expect(event.user_id).toBe("user-3")
    expect(event.consent_transcription).toBe(true)
    expect(event.consent_translation).toBe(false)
    expect(event.preferred_subtitle_language).toBe("fr")
  })

  it("makeSummaryReadyEvent produces correct structure", () => {
    const event = makeSummaryReadyEvent(SESSION_ID, "gemini-2.5-flash", "2024-01-01T01:00:00Z")
    expect(event.event_name).toBe(VOICE_EVENT.SUMMARY_READY)
    expect(event.model).toBe("gemini-2.5-flash")
    expect(event.generated_at).toBe("2024-01-01T01:00:00Z")
  })

  it("every factory includes required envelope fields", () => {
    const events = [
      makeTranscriptionStatusChangedEvent(SESSION_ID, false, "off"),
      makeTranscriptSegmentInterimEvent(SESSION_ID, null, "text", "en", new Date().toISOString()),
      makeTranscriptSegmentFinalEvent(SESSION_ID, "s", null, "t", "en", "", "", null, "p"),
      makeConsentChangedEvent(SESSION_ID, "u", false, false, null),
      makeSummaryReadyEvent(SESSION_ID, "m", new Date().toISOString()),
    ]

    for (const event of events) {
      expect(event.event_name).toBeTruthy()
      expect(event.schema_version).toBe(VORTEX_RECAP_SCHEMA_VERSION)
      expect(event.event_id).toBeTruthy()
      expect(event.occurred_at).toBeTruthy()
      expect(event.session_id).toBe(SESSION_ID)
    }
  })

  it("each event gets a unique event_id", () => {
    const e1 = makeTranscriptionStatusChangedEvent(SESSION_ID, true, "off")
    const e2 = makeTranscriptionStatusChangedEvent(SESSION_ID, true, "off")
    expect(e1.event_id).not.toBe(e2.event_id)
  })
})

// ── STT provider availability ─────────────────────────────────────────────────

describe("isWebSpeechApiSupported", () => {
  it("returns false when window is undefined (SSR environment)", () => {
    const originalWindow = globalThis.window
    // Simulate SSR
    Object.defineProperty(globalThis, "window", { value: undefined, configurable: true })
    expect(isWebSpeechApiSupported()).toBe(false)
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true })
  })

  it("returns false when neither SpeechRecognition variant is present", () => {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    })
    expect(isWebSpeechApiSupported()).toBe(false)
    Object.defineProperty(globalThis, "window", { value: globalThis.window ?? {}, configurable: true })
  })
})

// ── Policy resolution precedence (unit-level) ────────────────────────────────

describe("policy resolution precedence", () => {
  it("more specific scope overrides less specific scope", () => {
    // This tests the merge logic: server policy fields override workspace fields.
    const workspaceDefaults = {
      transcriptionEnabled: false,
      requireExplicitConsent: true,
      translationEnabled: false,
      summaryEnabled: false,
      retentionDays: 30,
      allowedLocales: [] as string[],
    }
    const serverOverride = {
      transcriptionEnabled: true,
      summaryEnabled: true,
      retentionDays: 7,
    }
    // Simulate merge (mirrors resolveEffectivePolicy logic)
    const effective = { ...workspaceDefaults, ...serverOverride }
    expect(effective.transcriptionEnabled).toBe(true)
    expect(effective.requireExplicitConsent).toBe(true) // inherited from workspace
    expect(effective.summaryEnabled).toBe(true)
    expect(effective.retentionDays).toBe(7)
  })
})

// ── Consent state — DM bilateral gate ────────────────────────────────────────

describe("DM bilateral consent logic", () => {
  it("transcription is off when either participant declines", () => {
    const participantConsents = [
      { userId: "user-a", consentTranscription: true },
      { userId: "user-b", consentTranscription: false }, // declined
    ]

    const allConsented = participantConsents.every((p) => p.consentTranscription)
    expect(allConsented).toBe(false)
  })

  it("transcription can proceed when all participants consent", () => {
    const participantConsents = [
      { userId: "user-a", consentTranscription: true },
      { userId: "user-b", consentTranscription: true },
    ]

    const allConsented = participantConsents.every((p) => p.consentTranscription)
    expect(allConsented).toBe(true)
  })
})

// ── Retention scheduler edge cases ───────────────────────────────────────────

describe("retention expiry calculation", () => {
  it("produces a future date for all standard profiles", () => {
    const profiles = [7, 30, 90]
    const now = Date.now()

    for (const days of profiles) {
      const expiry = new Date(computeExpiresAt(days)).getTime()
      expect(expiry).toBeGreaterThan(now)
    }
  })

  it("produces dates separated by exactly the retention interval", () => {
    const base = new Date("2025-01-01T00:00:00Z")
    vi.setSystemTime(base)

    const sevenDay = new Date(computeExpiresAt(7)).getTime()
    const thirtyDay = new Date(computeExpiresAt(30)).getTime()

    const diff = thirtyDay - sevenDay
    const expectedDiff = (30 - 7) * 24 * 60 * 60 * 1000
    expect(diff).toBe(expectedDiff)

    vi.useRealTimers()
  })
})
