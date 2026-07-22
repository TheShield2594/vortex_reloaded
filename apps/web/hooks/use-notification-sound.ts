"use client"

import { useCallback, useRef, useSyncExternalStore } from "react"
import { persistBooleanStorage } from "@/lib/utils/storage"
import { getNotificationVolume } from "@/hooks/use-notification-preferences"

const STORAGE_KEY = "vortexchat:notification-sound-enabled"

/** Notification sound categories — each plays a distinct audio cue. */
export type NotificationSoundType = "message" | "dm" | "mention"

// Paths to notification sound files served from /public
const SOUND_URLS: Record<NotificationSoundType, string> = {
  message: "/sounds/notification.wav",
  dm: "/sounds/notification-dm.wav",
  mention: "/sounds/notification-mention.wav",
}

// ---------------------------------------------------------------------------
// localStorage-backed setting with useSyncExternalStore for React sync
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((cb) => cb())
}

// Cross-tab sync: listen for storage events from other tabs
function onStorageEvent(e: StorageEvent): void {
  if (e.key === STORAGE_KEY || e.key === null) notifyListeners()
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorageEvent)
  }
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorageEvent)
    }
  }
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true
  return localStorage.getItem(STORAGE_KEY) !== "false"
}

function getServerSnapshot(): boolean {
  return true
}

function setNotificationSoundEnabled(enabled: boolean): void {
  persistBooleanStorage(STORAGE_KEY, enabled)
  notifyListeners()
}

// ---------------------------------------------------------------------------
// Audio file player — one preloaded template per sound type
// ---------------------------------------------------------------------------

const preloadedAudios: Partial<Record<NotificationSoundType, HTMLAudioElement>> = {}

function getPreloadedAudio(type: NotificationSoundType): HTMLAudioElement {
  if (!preloadedAudios[type]) {
    const audio = new Audio(SOUND_URLS[type])
    audio.preload = "auto"
    audio.volume = getNotificationVolume()
    preloadedAudios[type] = audio
  }
  return preloadedAudios[type]
}

async function playNotificationSound(type: NotificationSoundType = "message"): Promise<void> {
  try {
    const volume = getNotificationVolume()
    const template = getPreloadedAudio(type)
    // Clone so we can play overlapping sounds if rapid notifications arrive
    const audio = template.cloneNode(true) as HTMLAudioElement
    audio.volume = volume
    audio.currentTime = 0
    await audio.play()
  } catch {
    // Autoplay blocked or audio unavailable — fall back to Web Audio API tone
    try {
      await playFallbackTone(type)
    } catch {
      // Silent fallback — audio not available in this environment
    }
  }
}

// ---------------------------------------------------------------------------
// Distinct Web Audio API fallback tones per notification type
// ---------------------------------------------------------------------------

/** Tone definitions: [frequency, startTime, duration, peakGain] */
type ToneNote = { freq: number; start: number; dur: number; peak: number }

const TONE_PROFILES: Record<NotificationSoundType, { waveform: OscillatorType; notes: ToneNote[] }> = {
  // General message: gentle two-tone chime (C6 → E6)
  message: {
    waveform: "sine",
    notes: [
      { freq: 1047, start: 0, dur: 0.12, peak: 0.15 },
      { freq: 1319, start: 0.08, dur: 0.17, peak: 0.12 },
    ],
  },
  // DM: warm three-note ascending arpeggio (G5 → B5 → D6)
  dm: {
    waveform: "sine",
    notes: [
      { freq: 784, start: 0, dur: 0.1, peak: 0.14 },
      { freq: 988, start: 0.07, dur: 0.1, peak: 0.13 },
      { freq: 1175, start: 0.14, dur: 0.15, peak: 0.12 },
    ],
  },
  // Mention: brighter attention-grabbing double-tap (E6 → E6 with gap)
  mention: {
    waveform: "triangle",
    notes: [
      { freq: 1319, start: 0, dur: 0.08, peak: 0.18 },
      { freq: 1319, start: 0.12, dur: 0.08, peak: 0.18 },
      { freq: 1568, start: 0.22, dur: 0.12, peak: 0.14 },
    ],
  },
}

async function playFallbackTone(type: NotificationSoundType = "message"): Promise<void> {
  const volume = getNotificationVolume()
  const ctx = new AudioContext()

  try {
    if (ctx.state === "suspended") {
      await ctx.resume()
    }
  } catch {
    ctx.close().catch(() => {})
    return
  }

  const profile = TONE_PROFILES[type]
  let lastEnd = 0

  for (const note of profile.notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = profile.waveform
    osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.start)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.setValueAtTime(note.peak * volume, ctx.currentTime + note.start)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.start + note.dur)
    osc.start(ctx.currentTime + note.start)
    osc.stop(ctx.currentTime + note.start + note.dur)
    const end = note.start + note.dur
    if (end > lastEnd) lastEnd = end
  }

  setTimeout(() => {
    if (ctx.state !== "closed") {
      ctx.close().catch(() => {})
    }
  }, (lastEnd + 0.5) * 1000)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotificationSound(): {
  playNotification: (type?: NotificationSoundType) => void
  notificationSoundEnabled: boolean
  setNotificationSoundEnabled: (enabled: boolean) => void
} {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const lastPlayedRef = useRef(0)

  const playNotification = useCallback((type: NotificationSoundType = "message") => {
    if (!getSnapshot()) return

    // Debounce rapid successive plays (500ms)
    const now = Date.now()
    if (now - lastPlayedRef.current < 500) return
    lastPlayedRef.current = now

    playNotificationSound(type)
  }, [])

  return {
    playNotification,
    notificationSoundEnabled: enabled,
    setNotificationSoundEnabled,
  }
}
