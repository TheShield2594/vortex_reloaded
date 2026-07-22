"use client"

// STT (Speech-to-Text) provider abstraction.
// The default implementation uses the Web Speech API (SpeechRecognition),
// which is available in Chrome/Edge without any API key.
// The interface is designed to be swappable for cloud providers (Deepgram,
// AssemblyAI, etc.) in the future by implementing STTProvider.

export interface STTSegment {
  text: string
  isFinal: boolean
  confidence: number | null
  startedAt: Date
  endedAt: Date
}

export interface STTProvider {
  /** Start recognition on the given audio stream. */
  start(stream: MediaStream, language: string): void
  /** Stop recognition and release resources. */
  stop(): void
  /** Called with each interim or final segment. */
  onSegment: ((segment: STTSegment) => void) | null
  /** Called when recognition ends (naturally or via stop()). */
  onEnd: (() => void) | null
  /** Called on recognition error. */
  onError: ((error: string) => void) | null
}

// ── Web Speech API provider ───────────────────────────────────────────────────

// SpeechRecognition is not in all TypeScript DOM lib versions; declare minimally.
interface SpeechRecognitionInstance {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventCompat) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventCompat) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionResultAlt {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResultCompat {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionResultAlt
}

interface SpeechRecognitionEventCompat {
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultCompat }
}

interface SpeechRecognitionErrorEventCompat {
  readonly error: string
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getSpeechRecognitionConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  return (
    (window as typeof window & { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition ??
    null
  )
}

/** Returns true when the current browser supports the Web Speech API. */
export function isWebSpeechApiSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null
}

export class WebSpeechSTTProvider implements STTProvider {
  onSegment: ((segment: STTSegment) => void) | null = null
  onEnd: (() => void) | null = null
  onError: ((error: string) => void) | null = null

  private recognition: SpeechRecognitionInstance | null = null
  private startTime: Date = new Date()

  start(stream: MediaStream, language: string): void {
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) {
      this.onError?.("Web Speech API is not supported in this browser")
      return
    }

    // The Web Speech API uses the default microphone, not an arbitrary stream.
    // We accept the stream parameter to satisfy the interface (future providers
    // may process it directly via AudioWorklets).
    void stream

    const recognition = new SpeechRecognition()
    this.recognition = recognition
    this.startTime = new Date()

    recognition.lang = language
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.continuous = true

    recognition.onresult = (event: SpeechRecognitionEventCompat) => {
      const result = event.results[event.results.length - 1]
      if (!result) return

      const alt = result[0]
      const now = new Date()
      const segment: STTSegment = {
        text: alt.transcript,
        isFinal: result.isFinal,
        confidence: result.isFinal ? alt.confidence : null,
        startedAt: this.startTime,
        endedAt: now,
      }

      if (result.isFinal) {
        this.startTime = now
      }

      this.onSegment?.(segment)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEventCompat) => {
      // 'no-speech' and 'aborted' are expected during silence/stop; ignore them
      if (event.error === "no-speech" || event.error === "aborted") return
      this.onError?.(event.error)
    }

    recognition.onend = () => {
      this.onEnd?.()
    }

    recognition.start()
  }

  stop(): void {
    try {
      this.recognition?.stop()
    } catch {
      // already stopped
    }
    this.recognition = null
  }
}

/** Create the best available STT provider for the current environment. */
export function createSTTProvider(): STTProvider | null {
  if (isWebSpeechApiSupported()) {
    return new WebSpeechSTTProvider()
  }
  return null
}
