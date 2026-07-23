import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEqTrackProcessor } from "@/lib/voice/eq-track-processor"
import { createDefaultAudioSettings, applyPresetToSettings, withEqBandGain } from "@/lib/voice/audio-settings"
import type { AudioProcessorOptions } from "livekit-client"

/**
 * Minimal Web Audio stand-in — vitest runs in a Node environment with no
 * real AudioContext, so every node the pipeline touches needs a fake with
 * the same shape (`.value`-holding AudioParams, connect/disconnect, etc).
 */
class FakeAudioParam {
  value = 0
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value
  })
}

class FakeAudioNode {
  connections: FakeAudioNode[] = []
  disconnect = vi.fn(() => {
    this.connections = []
  })
  connect = vi.fn((dest: FakeAudioNode) => {
    this.connections.push(dest)
    return dest
  })
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam()
}

class FakeCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam()
  ratio = new FakeAudioParam()
  attack = new FakeAudioParam()
  release = new FakeAudioParam()
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type = ""
  frequency = new FakeAudioParam()
  gain = new FakeAudioParam()
  Q = new FakeAudioParam()
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 0
  /** Test hook: signal level fed back on the next `getFloatTimeDomainData` call. */
  nextRms = 0
  getFloatTimeDomainData(data: Float32Array) {
    data.fill(this.nextRms)
  }
}

class FakeMediaStreamAudioDestinationNode extends FakeAudioNode {
  private track: MediaStreamTrack
  stream: MediaStream

  constructor() {
    super()
    this.track = { id: `track-${Math.random()}`, kind: "audio" } as unknown as MediaStreamTrack
    this.stream = { getAudioTracks: () => [this.track] } as unknown as MediaStream
  }
}

class FakeAudioContext {
  currentTime = 0
  createMediaStreamSource = vi.fn((_stream: MediaStream) => new FakeAudioNode())
  createGain = vi.fn(() => new FakeGainNode())
  createDynamicsCompressor = vi.fn(() => new FakeCompressorNode())
  createBiquadFilter = vi.fn(() => new FakeBiquadFilterNode())
  createAnalyser = vi.fn(() => new FakeAnalyserNode())
  createMediaStreamDestination = vi.fn(() => new FakeMediaStreamAudioDestinationNode())
}

function fakeTrack(id: string): MediaStreamTrack {
  return { id, kind: "audio" } as unknown as MediaStreamTrack
}

// Node's vitest environment has no MediaStream global — the fake
// AudioContext never inspects the stream it's handed, so a trivial stub
// is enough for `new MediaStream([track])` in eq-track-processor.ts to run.
class FakeMediaStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getAudioTracks() {
    return this.tracks
  }
}
vi.stubGlobal("MediaStream", FakeMediaStream)

function optionsFor(audioContext: FakeAudioContext, track: MediaStreamTrack): AudioProcessorOptions {
  return {
    kind: "audio",
    track,
    audioContext: audioContext as unknown as AudioContext,
  } as unknown as AudioProcessorOptions
}

describe("eq track processor", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("builds the graph and exposes a processed track on init", async () => {
    const audioContext = new FakeAudioContext()
    const processor = createEqTrackProcessor(createDefaultAudioSettings())

    await processor.init(optionsFor(audioContext, fakeTrack("mic-1")))

    expect(processor.processedTrack).toBeDefined()
    expect(audioContext.createGain).toHaveBeenCalled()
    expect(audioContext.createBiquadFilter).toHaveBeenCalledTimes(6)
  })

  it("updateSettings re-tunes AudioParams in place without rebuilding the graph", async () => {
    const audioContext = new FakeAudioContext()
    const processor = createEqTrackProcessor(createDefaultAudioSettings())
    await processor.init(optionsFor(audioContext, fakeTrack("mic-1")))

    const processedTrackBefore = processor.processedTrack
    const createGainCallsBefore = audioContext.createGain.mock.calls.length
    const createBiquadCallsBefore = audioContext.createBiquadFilter.mock.calls.length

    const broadcastPreset = applyPresetToSettings("broadcast", createDefaultAudioSettings())
    processor.updateSettings(broadcastPreset)

    // Same processed track, no new nodes created — this is what lets a slider
    // drag or preset switch skip LiveKit's restart() entirely.
    expect(processor.processedTrack).toBe(processedTrackBefore)
    expect(audioContext.createGain.mock.calls.length).toBe(createGainCallsBefore)
    expect(audioContext.createBiquadFilter.mock.calls.length).toBe(createBiquadCallsBefore)
  })

  it("restart() tears down the old graph and builds a fresh one against the new track", async () => {
    const audioContext = new FakeAudioContext()
    const processor = createEqTrackProcessor(createDefaultAudioSettings())
    await processor.init(optionsFor(audioContext, fakeTrack("mic-1")))

    const processedTrackBefore = processor.processedTrack
    const createBiquadCallsBefore = audioContext.createBiquadFilter.mock.calls.length

    await processor.restart(optionsFor(audioContext, fakeTrack("mic-2")))

    expect(processor.processedTrack).not.toBe(processedTrackBefore)
    // A whole new graph was built (new filters created), matching what
    // LiveKit expects restart() to do for a genuine device swap.
    expect(audioContext.createBiquadFilter.mock.calls.length).toBe(createBiquadCallsBefore + 6)
  })

  it("destroy() disconnects every node and clears the processed track", async () => {
    const audioContext = new FakeAudioContext()
    const processor = createEqTrackProcessor(createDefaultAudioSettings())
    await processor.init(optionsFor(audioContext, fakeTrack("mic-1")))

    await processor.destroy()

    expect(processor.processedTrack).toBeUndefined()
  })

  it("noise gate closes on a quiet signal after the same 100ms poll as the P2P pipeline", async () => {
    const audioContext = new FakeAudioContext()
    const settings = createDefaultAudioSettings()
    const processor = createEqTrackProcessor(settings)
    await processor.init(optionsFor(audioContext, fakeTrack("mic-1")))

    const analyser = audioContext.createAnalyser.mock.results[0]!.value as FakeAnalyserNode
    const gateGain = audioContext.createGain.mock.results[1]!.value as FakeGainNode // [0]=inputGain, [1]=gateGain
    analyser.nextRms = 0 // silence -> well below any noiseGateThreshold

    vi.advanceTimersByTime(100)

    expect(gateGain.gain.setTargetAtTime).toHaveBeenCalledWith(
      settings.noiseGateFloor,
      audioContext.currentTime,
      0.1
    )
  })

  it("updateSettings changes the noise gate floor used on the next poll tick", async () => {
    const audioContext = new FakeAudioContext()
    const processor = createEqTrackProcessor(createDefaultAudioSettings())
    await processor.init(optionsFor(audioContext, fakeTrack("mic-1")))

    const analyser = audioContext.createAnalyser.mock.results[0]!.value as FakeAnalyserNode
    const gateGain = audioContext.createGain.mock.results[1]!.value as FakeGainNode
    analyser.nextRms = 0

    const customSettings = withEqBandGain(createDefaultAudioSettings(), 0, 4)
    customSettings.noiseGateFloor = 0.5
    processor.updateSettings(customSettings)

    vi.advanceTimersByTime(100)

    expect(gateGain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, audioContext.currentTime, 0.1)
  })
})
