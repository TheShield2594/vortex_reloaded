import type { MutableRefObject } from "react"
import { estimateAudioCpuConstraint, type VoiceAudioSettings } from "@/lib/voice/audio-settings"

export interface InputAudioPipeline {
  processedStream: MediaStream
  cleanup: () => void
  constrainedCpu: boolean
  bypassed: boolean
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

  const intervalId = window.setInterval(() => {
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

  return { processedStream: destination.stream, cleanup, constrainedCpu, bypassed: false }
}
