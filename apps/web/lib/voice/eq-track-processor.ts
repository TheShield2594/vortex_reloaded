import type { AudioProcessorOptions, TrackProcessor } from "livekit-client"
import { Track } from "livekit-client"
import { buildEqAudioGraph, type EqAudioGraph } from "@/lib/voice/audio-pipeline"
import type { VoiceAudioSettings } from "@/lib/voice/audio-settings"

export const EQ_TRACK_PROCESSOR_NAME = "vortex-eq-processor"

/**
 * LiveKit TrackProcessor port of `createInputAudioPipeline` (see that file's
 * `buildEqAudioGraph`). LiveKit only calls `restart()` when it swaps the
 * underlying MediaStreamTrack (e.g. a device change) — see
 * `LocalTrack.setMediaStreamTrack` in `livekit-client`. Everything else
 * (slider drags, preset switches) should go through `updateSettings`, which
 * tweaks the already-built graph's AudioParams in place.
 */
export interface EqTrackProcessor extends TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  /** Re-tune the live graph without rebuilding it or touching LiveKit's restart(). */
  updateSettings: (settings: VoiceAudioSettings) => void
}

export function createEqTrackProcessor(initialSettings: VoiceAudioSettings): EqTrackProcessor {
  let settings = initialSettings
  let graph: EqAudioGraph | null = null
  // `restart()`'s real call site (LocalTrack.setMediaStreamTrack in
  // livekit-client) only passes { track, kind, element } — no audioContext,
  // despite the `AudioProcessorOptions` type on `restart` claiming it's
  // required. Only `init()` ever actually receives it, so it must be cached
  // here and reused on every restart.
  let audioContext: AudioContext | null = null

  function buildFrom(track: MediaStreamTrack) {
    if (!audioContext) throw new Error("EqTrackProcessor.init() must run before restart()")
    const source = audioContext.createMediaStreamSource(new MediaStream([track]))
    graph = buildEqAudioGraph(audioContext, source, settings)
    processor.processedTrack = graph.destination.stream.getAudioTracks()[0]
  }

  const processor: EqTrackProcessor = {
    name: EQ_TRACK_PROCESSOR_NAME,
    processedTrack: undefined,

    async init(opts) {
      audioContext = opts.audioContext
      buildFrom(opts.track)
    },

    async restart(opts) {
      graph?.cleanup()
      graph = null
      buildFrom(opts.track)
    },

    async destroy() {
      graph?.cleanup()
      graph = null
      processor.processedTrack = undefined
    },

    updateSettings(nextSettings) {
      settings = nextSettings
      graph?.updateSettings(nextSettings)
    },
  }

  return processor
}
