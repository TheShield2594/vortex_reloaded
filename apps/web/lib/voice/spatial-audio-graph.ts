import type { ParticipantAudio } from "@/lib/stores/voice-audio-store"

export interface SpatialAudioGraph {
  /** Re-tune volume/pan on the already-built graph in place. Safe to call on every store update. */
  updateMix: (mix: ParticipantAudio) => void
  /** Disconnect every node in the graph. */
  cleanup: () => void
}

/**
 * Route one remote participant's audio through a gain -> stereo panner chain
 * into the call's shared AudioContext destination, so a group call can mix
 * each speaker's volume and left/right position instead of every voice
 * arriving dead-center at the same level. Mirrors `buildEqAudioGraph`'s
 * build-once/update-in-place shape for the outgoing EQ chain.
 */
export function buildSpatialAudioGraph(
  audioContext: AudioContext,
  stream: MediaStream,
  initialMix: ParticipantAudio
): SpatialAudioGraph {
  const source = audioContext.createMediaStreamSource(stream)
  const gainNode = audioContext.createGain()
  gainNode.gain.value = initialMix.volume
  const pannerNode = audioContext.createStereoPanner()
  pannerNode.pan.value = initialMix.pan ?? 0

  source.connect(gainNode)
  gainNode.connect(pannerNode)
  pannerNode.connect(audioContext.destination)

  const updateMix = (mix: ParticipantAudio) => {
    gainNode.gain.value = mix.volume
    pannerNode.pan.value = mix.pan ?? 0
  }

  const cleanup = () => {
    ;[source, gainNode, pannerNode].forEach((node) => {
      try {
        node.disconnect()
      } catch {
        // no-op
      }
    })
  }

  return { updateMix, cleanup }
}
