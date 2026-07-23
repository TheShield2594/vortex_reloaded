import { LocalAudioTrack, Track } from "livekit-client"
import { createEqTrackProcessor } from "../../apps/web/lib/voice/eq-track-processor"
import { createDefaultAudioSettings, applyPresetToSettings } from "../../apps/web/lib/voice/audio-settings"

/**
 * Runs entirely client-side against the real `livekit-client` package — no
 * `livekit-server` connection involved. `LocalAudioTrack.setProcessor()`,
 * `.restartTrack()`, and the processor lifecycle they drive are pure
 * client-side track/processor plumbing (confirmed by reading
 * `livekit-client`'s compiled source: `processor.restart()` is only called
 * from `LocalTrack.setMediaStreamTrack`, which only runs from
 * `restart()`/`restartTrack()` — never from a room/signaling path). So this
 * exercises the exact code path the spike's checklist cares about without
 * needing a live SFU.
 */
async function main() {
  const results: Record<string, unknown> = {}
  const errors: string[] = []

  function check(name: string, condition: boolean, detail?: unknown) {
    results[name] = condition
    if (!condition) errors.push(`${name}: FAILED ${detail !== undefined ? JSON.stringify(detail) : ""}`)
  }

  const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rawTrack = rawStream.getAudioTracks()[0]

  const audioContext = new AudioContext()
  const localTrack = new LocalAudioTrack(rawTrack, undefined, true, audioContext)

  const processor = createEqTrackProcessor(createDefaultAudioSettings())
  let restartCallCount = 0
  const originalRestart = processor.restart.bind(processor)
  processor.restart = async (opts) => {
    restartCallCount++
    return originalRestart(opts)
  }

  // ── 1. Wrap the existing Web Audio graph in a TrackProcessor ──────────────
  await localTrack.setProcessor(processor)
  const processedTrackAfterInit = processor.processedTrack
  check("local_track_is_real_livekit_instance", localTrack.kind === Track.Kind.Audio)
  check("processed_track_exists_after_init", !!processedTrackAfterInit)
  check(
    "processed_track_is_live_and_distinct_from_raw",
    !!processedTrackAfterInit &&
      processedTrackAfterInit.readyState === "live" &&
      processedTrackAfterInit.id !== rawTrack.id
  )
  check("restart_not_called_by_setProcessor", restartCallCount === 0, { restartCallCount })

  // ── 2. Parameter changes (slider drag / preset switch) skip restart() ────
  const broadcastPreset = applyPresetToSettings("broadcast", createDefaultAudioSettings())
  processor.updateSettings(broadcastPreset)
  processor.updateSettings(applyPresetToSettings("bass-boost", createDefaultAudioSettings()))
  processor.updateSettings(applyPresetToSettings("voice-clarity", createDefaultAudioSettings()))
  check("restart_not_called_by_updateSettings", restartCallCount === 0, { restartCallCount })
  check("processed_track_unchanged_by_updateSettings", processor.processedTrack === processedTrackAfterInit)

  // ── genuine device swap DOES trigger LiveKit's restart() ─────────────────
  await localTrack.restartTrack()
  check("restart_called_exactly_once_by_restartTrack", restartCallCount === 1, { restartCallCount })
  check(
    "processed_track_rebuilt_after_restart",
    !!processor.processedTrack &&
      processor.processedTrack !== processedTrackAfterInit &&
      processor.processedTrack.readyState === "live"
  )

  await processor.destroy()
  check("processed_track_cleared_after_destroy", processor.processedTrack === undefined)

  ;(window as unknown as { __spikeResults__: unknown }).__spikeResults__ = { results, errors, ok: errors.length === 0 }
}

main().catch((err) => {
  ;(window as unknown as { __spikeResults__: unknown }).__spikeResults__ = {
    results: {},
    errors: [`threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`],
    ok: false,
  }
})
