export type EQBand = {
  frequency: number
  gain: number
  q: number
}

export type AudioPreset = "voice-clarity" | "bass-boost" | "broadcast" | "flat"

export interface VoiceAudioSettings {
  preset: AudioPreset
  inputGain: number
  outputGain: number
  compressorThreshold: number
  compressorRatio: number
  compressorAttack: number
  compressorRelease: number
  noiseGateThreshold: number
  noiseGateFloor: number
  eqBands: EQBand[]
  bypassProcessing: boolean
  bypassOnCpuConstraint: boolean
  spatialAudioEnabled: boolean
}

const DEFAULT_FREQUENCIES = [60, 170, 350, 1000, 3500, 10000]

function baseBands(): EQBand[] {
  return DEFAULT_FREQUENCIES.map((frequency) => ({ frequency, gain: 0, q: 1 }))
}

export const AUDIO_PRESETS: Record<AudioPreset, Partial<VoiceAudioSettings>> = {
  "voice-clarity": {
    inputGain: 1,
    outputGain: 1,
    compressorThreshold: -28,
    compressorRatio: 4,
    compressorAttack: 0.01,
    compressorRelease: 0.22,
    noiseGateThreshold: -56,
    noiseGateFloor: 0.12,
    eqBands: [
      { frequency: 60, gain: -3, q: 1 },
      { frequency: 170, gain: -2, q: 1.1 },
      { frequency: 350, gain: 1.5, q: 1 },
      { frequency: 1000, gain: 3, q: 1.2 },
      { frequency: 3500, gain: 3.5, q: 1.2 },
      { frequency: 10000, gain: 1.5, q: 0.9 },
    ],
  },
  "bass-boost": {
    inputGain: 1.05,
    outputGain: 1,
    compressorThreshold: -24,
    compressorRatio: 3,
    compressorAttack: 0.02,
    compressorRelease: 0.25,
    noiseGateThreshold: -58,
    noiseGateFloor: 0.12,
    eqBands: [
      { frequency: 60, gain: 5, q: 0.8 },
      { frequency: 170, gain: 3.5, q: 0.9 },
      { frequency: 350, gain: 2, q: 1 },
      { frequency: 1000, gain: 0.5, q: 1 },
      { frequency: 3500, gain: -1, q: 1.1 },
      { frequency: 10000, gain: -1.5, q: 1.1 },
    ],
  },
  broadcast: {
    inputGain: 1.1,
    outputGain: 1,
    compressorThreshold: -22,
    compressorRatio: 5,
    compressorAttack: 0.005,
    compressorRelease: 0.16,
    noiseGateThreshold: -50,
    noiseGateFloor: 0.1,
    eqBands: [
      { frequency: 60, gain: -2, q: 1 },
      { frequency: 170, gain: -1, q: 1 },
      { frequency: 350, gain: 2, q: 1.1 },
      { frequency: 1000, gain: 2.5, q: 1.2 },
      { frequency: 3500, gain: 4, q: 1.3 },
      { frequency: 10000, gain: 2.5, q: 1 },
    ],
  },
  flat: {
    inputGain: 1,
    outputGain: 1,
    compressorThreshold: -30,
    compressorRatio: 2,
    compressorAttack: 0.03,
    compressorRelease: 0.3,
    noiseGateThreshold: -60,
    noiseGateFloor: 0.15,
    eqBands: baseBands(),
  },
}

export function createDefaultAudioSettings(): VoiceAudioSettings {
  const flatPreset = AUDIO_PRESETS.flat
  const defaultSettings: VoiceAudioSettings = {
    preset: "voice-clarity",
    inputGain: flatPreset.inputGain ?? 1,
    outputGain: flatPreset.outputGain ?? 1,
    compressorThreshold: flatPreset.compressorThreshold ?? -30,
    compressorRatio: flatPreset.compressorRatio ?? 2,
    compressorAttack: flatPreset.compressorAttack ?? 0.03,
    compressorRelease: flatPreset.compressorRelease ?? 0.3,
    noiseGateThreshold: flatPreset.noiseGateThreshold ?? -60,
    noiseGateFloor: flatPreset.noiseGateFloor ?? 0.15,
    eqBands: (flatPreset.eqBands ?? baseBands()).map((band) => ({ ...band })),
    bypassProcessing: false,
    bypassOnCpuConstraint: true,
    spatialAudioEnabled: false,
  }

  return applyPresetToSettings("voice-clarity", defaultSettings)
}

export function applyPresetToSettings(
  preset: AudioPreset,
  current: VoiceAudioSettings
): VoiceAudioSettings {
  const presetSettings = AUDIO_PRESETS[preset]
  return {
    ...current,
    ...presetSettings,
    preset,
    eqBands: (presetSettings.eqBands ?? current.eqBands).map((band) => ({ ...band })),
  }
}

export function withEqBandGain(
  settings: VoiceAudioSettings,
  index: number,
  gain: number
): VoiceAudioSettings {
  if (index < 0 || index >= settings.eqBands.length) {
    throw new RangeError(`EQ band index out of range: index=${index}, length=${settings.eqBands.length}`)
  }

  const nextBands = settings.eqBands.map((band, bandIndex) =>
    bandIndex === index ? { ...band, gain } : band
  )
  return { ...settings, eqBands: nextBands, preset: "flat" }
}

export function estimateAudioCpuConstraint(audioContext: AudioContext): boolean {
  if (typeof navigator === "undefined") return false

  const hardwareThreads = navigator.hardwareConcurrency ?? 4
  const sampleRate = audioContext.sampleRate
  const baseLatency = audioContext.baseLatency ?? 0

  return hardwareThreads <= 2 || sampleRate > 96000 || baseLatency > 0.05
}
