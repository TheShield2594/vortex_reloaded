import type { MutableRefObject } from "react"
import { estimateAudioCpuConstraint, type VoiceAudioSettings } from "@/lib/voice/audio-settings"

export interface InputAudioPipeline {
  processedStream: MediaStream
  cleanup: () => void
  constrainedCpu: boolean
  bypassed: boolean
}

export interface EqAudioGraph {
  /** Destination node whose `.stream` carries the fully-processed audio. */
  destination: MediaStreamAudioDestinationNode
  /**
   * Apply new gain/compressor/EQ/noise-gate values to the already-built graph
   * in place — no node is created, connected, or destroyed. Safe to call on
   * every slider drag or preset switch.
   */
  updateSettings: (settings: VoiceAudioSettings) => void
  /** Stop the noise-gate poll and disconnect every node in the graph. */
  cleanup: () => void
}

/**
 * Build the gain -> compressor -> noise-gate -> 6-band EQ -> gain node chain
 * shared by every consumer of the audio pipeline. `updateSettings` lets a
 * caller re-tune the graph without tearing it down, which is what LiveKit's
 * TrackProcessor.restart() is for — it's reserved for swapping the upstream
 * track (device changes), not for parameter changes.
 */
export function buildEqAudioGraph(
  audioContext: AudioContext,
  source: AudioNode,
  initialSettings: VoiceAudioSettings
): EqAudioGraph {
  let settings = initialSettings

  const inputGain = audioContext.createGain()
  inputGain.gain.value = settings.inputGain

  const compressor = audioContext.createDynamicsCompressor()
  compressor.threshold.value = settings.compressorThreshold
  compressor.ratio.value = settings.compressorRatio
  compressor.attack.value = settings.compressorAttack
  compressor.release.value = settings.compressorRelease

  const gateGain = audioContext.createGain()
  gateGain.gain.value = 1
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  const data = new Float32Array(analyser.fftSize)

  const eqFilters = settings.eqBands.map((band) => {
    const filter = audioContext.createBiquadFilter()
    filter.type = "peaking"
    filter.frequency.value = band.frequency
    filter.gain.value = band.gain
    filter.Q.value = band.q
    return filter
  })

  const outputGain = audioContext.createGain()
  outputGain.gain.value = settings.outputGain

  const destination = audioContext.createMediaStreamDestination()

  source.connect(inputGain)
  inputGain.connect(compressor)
  compressor.connect(analyser)
  analyser.connect(gateGain)

  let node: AudioNode = gateGain
  for (const filter of eqFilters) {
    node.connect(filter)
    node = filter
  }

  node.connect(outputGain)
  outputGain.connect(destination)

  const intervalId = globalThis.setInterval(() => {
    analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const sample of data) sum += sample * sample
    const rms = Math.sqrt(sum / data.length)
    const db = 20 * Math.log10(Math.max(rms, 0.00001))
    const gateIsClosing = db < settings.noiseGateThreshold
    const targetGain = gateIsClosing ? settings.noiseGateFloor : 1
    const timeConstant = gateIsClosing ? 0.1 : 0.005
    gateGain.gain.setTargetAtTime(targetGain, audioContext.currentTime, timeConstant)
  }, 100)

  const updateSettings = (nextSettings: VoiceAudioSettings) => {
    settings = nextSettings
    inputGain.gain.value = settings.inputGain
    compressor.threshold.value = settings.compressorThreshold
    compressor.ratio.value = settings.compressorRatio
    compressor.attack.value = settings.compressorAttack
    compressor.release.value = settings.compressorRelease
    outputGain.gain.value = settings.outputGain
    settings.eqBands.forEach((band, index) => {
      const filter = eqFilters[index]
      if (!filter) return
      filter.frequency.value = band.frequency
      filter.gain.value = band.gain
      filter.Q.value = band.q
    })
    // noiseGateThreshold/Floor are read live from `settings` inside the poll above
  }

  const cleanup = () => {
    clearInterval(intervalId)
    ;[source, inputGain, compressor, gateGain, analyser, ...eqFilters, outputGain, destination].forEach((n) => {
      try {
        n.disconnect()
      } catch {
        // no-op
      }
    })
  }

  return { destination, updateSettings, cleanup }
}

/** Build a Web Audio processing chain (gain, compressor, noise gate, EQ) for a raw microphone stream. */
export function createInputAudioPipeline(
  rawStream: MediaStream,
  settings: VoiceAudioSettings,
  audioContextRef: MutableRefObject<AudioContext | null>
): InputAudioPipeline {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) {
    return { processedStream: rawStream, cleanup: () => {}, constrainedCpu: false, bypassed: true }
  }

  const audioContext = audioContextRef.current ?? new AudioCtx()
  audioContextRef.current = audioContext

  const constrainedCpu = settings.bypassOnCpuConstraint && estimateAudioCpuConstraint(audioContext)
  const shouldBypass = settings.bypassProcessing || constrainedCpu

  if (shouldBypass) {
    return {
      processedStream: rawStream,
      cleanup: () => {},
      constrainedCpu,
      bypassed: true,
    }
  }

  const source = audioContext.createMediaStreamSource(rawStream)
  const graph = buildEqAudioGraph(audioContext, source, settings)

  return { processedStream: graph.destination.stream, cleanup: graph.cleanup, constrainedCpu, bypassed: false }
}
