import { describe, expect, it, vi } from "vitest"
import { buildSpatialAudioGraph } from "@/lib/voice/spatial-audio-graph"

/** Minimal Web Audio stand-in — mirrors the fakes in eq-track-processor.test.ts. */
class FakeAudioParam {
  value = 0
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

class FakeStereoPannerNode extends FakeAudioNode {
  pan = new FakeAudioParam()
}

class FakeAudioContext {
  destination = new FakeAudioNode()
  createMediaStreamSource = vi.fn((_stream: MediaStream) => new FakeAudioNode())
  createGain = vi.fn(() => new FakeGainNode())
  createStereoPanner = vi.fn(() => new FakeStereoPannerNode())
}

function fakeStream(): MediaStream {
  return {} as unknown as MediaStream
}

describe("spatial audio graph", () => {
  it("builds a source -> gain -> panner -> destination chain seeded from the initial mix", () => {
    const audioContext = new FakeAudioContext()
    buildSpatialAudioGraph(audioContext as unknown as AudioContext, fakeStream(), { volume: 1.5, pan: -0.5 })

    const source = audioContext.createMediaStreamSource.mock.results[0]!.value as FakeAudioNode
    const gain = audioContext.createGain.mock.results[0]!.value as FakeGainNode
    const panner = audioContext.createStereoPanner.mock.results[0]!.value as FakeStereoPannerNode

    expect(gain.gain.value).toBe(1.5)
    expect(panner.pan.value).toBe(-0.5)
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(panner)
    expect(panner.connect).toHaveBeenCalledWith(audioContext.destination)
  })

  it("defaults pan to center when the mix has no pan set", () => {
    const audioContext = new FakeAudioContext()
    buildSpatialAudioGraph(audioContext as unknown as AudioContext, fakeStream(), { volume: 1, pan: null })

    const panner = audioContext.createStereoPanner.mock.results[0]!.value as FakeStereoPannerNode
    expect(panner.pan.value).toBe(0)
  })

  it("updateMix re-tunes gain/pan in place without rebuilding the graph", () => {
    const audioContext = new FakeAudioContext()
    const graph = buildSpatialAudioGraph(audioContext as unknown as AudioContext, fakeStream(), { volume: 1, pan: 0 })

    graph.updateMix({ volume: 0.4, pan: 0.9 })

    const gain = audioContext.createGain.mock.results[0]!.value as FakeGainNode
    const panner = audioContext.createStereoPanner.mock.results[0]!.value as FakeStereoPannerNode
    expect(gain.gain.value).toBe(0.4)
    expect(panner.pan.value).toBe(0.9)
    expect(audioContext.createMediaStreamSource).toHaveBeenCalledTimes(1)
  })

  it("cleanup disconnects every node in the graph", () => {
    const audioContext = new FakeAudioContext()
    const graph = buildSpatialAudioGraph(audioContext as unknown as AudioContext, fakeStream(), { volume: 1, pan: 0 })

    graph.cleanup()

    const source = audioContext.createMediaStreamSource.mock.results[0]!.value as FakeAudioNode
    const gain = audioContext.createGain.mock.results[0]!.value as FakeGainNode
    const panner = audioContext.createStereoPanner.mock.results[0]!.value as FakeStereoPannerNode
    expect(source.disconnect).toHaveBeenCalled()
    expect(gain.disconnect).toHaveBeenCalled()
    expect(panner.disconnect).toHaveBeenCalled()
  })
})
