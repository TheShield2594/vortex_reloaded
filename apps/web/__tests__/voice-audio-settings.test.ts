import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  applyPresetToSettings,
  createDefaultAudioSettings,
  estimateAudioCpuConstraint,
  withEqBandGain,
} from "@/lib/voice/audio-settings"

describe("voice audio settings", () => {
  let originalNavigator: Navigator

  function setNavigatorStub(hardwareConcurrency: number) {
    Object.defineProperty(globalThis, "navigator", {
      value: { hardwareConcurrency },
      configurable: true,
    })
  }

  beforeEach(() => {
    originalNavigator = globalThis.navigator
  })

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    })
  })

  it("applies preset EQ values", () => {
    const defaults = createDefaultAudioSettings()
    const updated = applyPresetToSettings("broadcast", defaults)
    expect(updated.preset).toBe("broadcast")
    expect(updated.eqBands.map((band) => band.gain)).toEqual([-2, -1, 2, 2.5, 4, 2.5])
  })

  it("switches to flat when custom EQ is edited", () => {
    const defaults = createDefaultAudioSettings()
    const updated = withEqBandGain(defaults, 1, 6)
    expect(updated.preset).toBe("flat")
    expect(updated.eqBands[1].gain).toBe(6)
  })

  it("flags constrained cpu on low core count", () => {
    setNavigatorStub(2)

    const constrained = estimateAudioCpuConstraint({
      sampleRate: 48000,
      baseLatency: 0.01,
    } as AudioContext)

    expect(constrained).toBe(true)
  })

  it("flags constrained cpu on high sampleRate", () => {
    setNavigatorStub(8)

    const constrained = estimateAudioCpuConstraint({
      sampleRate: 96001,
      baseLatency: 0.01,
    } as AudioContext)

    expect(constrained).toBe(true)
  })

  it("flags constrained cpu on high baseLatency", () => {
    setNavigatorStub(8)

    const constrained = estimateAudioCpuConstraint({
      sampleRate: 48000,
      baseLatency: 0.06,
    } as AudioContext)

    expect(constrained).toBe(true)
  })

  it("does not flag constrained cpu for unconstrained environment", () => {
    setNavigatorStub(8)

    const constrained = estimateAudioCpuConstraint({
      sampleRate: 48000,
      baseLatency: 0.01,
    } as AudioContext)

    expect(constrained).toBe(false)
  })
})
