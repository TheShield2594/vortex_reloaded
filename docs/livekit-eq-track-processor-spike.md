# Spike: EQ pipeline as a LiveKit TrackProcessor

Findings for [#11](https://github.com/TheShield2594/vortex_reloaded/issues/11),
a pre-migration spike blocking the token-mint/media-transport swap issue that
wires this processor into the live call path. Runnable code lives in
`spikes/livekit-eq-processor/` and the production port lives in
`apps/web/lib/voice/eq-track-processor.ts`.

## Summary

All three checklist items check out, with one real bug caught along the way:

1. **Wrapping the graph works.** `createEqTrackProcessor()` in
   `apps/web/lib/voice/eq-track-processor.ts` implements `livekit-client`'s
   `TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>` interface
   (`init`/`restart`/`destroy`/`processedTrack`) and reuses the exact same
   Web Audio node graph as the existing P2P pipeline via a new shared
   `buildEqAudioGraph()` helper (extracted from
   `apps/web/lib/voice/audio-pipeline.ts` — no behavior change to the live
   P2P path, `createInputAudioPipeline` calls the same helper it always
   inlined).
2. **Parameter changes don't need `restart()`.** Confirmed both by reading
   `livekit-client`'s compiled source and by exercising the real class:
   `LocalTrack.setMediaStreamTrack` — the only call site for
   `processor.restart()` — only runs from `LocalTrack.restart()` /
   `restartTrack()`, i.e. a genuine device swap. `EqTrackProcessor` exposes
   `updateSettings(settings)`, which writes directly to the already-built
   graph's `AudioParam`s (gain, compressor, EQ bands) — the same pattern
   `withEqBandGain`/`applyPresetToSettings` already produce — and never
   touches `restart`.
3. **The noise gate's 100ms poll is unchanged.** It's the same
   `setInterval` + `AnalyserNode.getFloatTimeDomainData` loop, now living
   inside `buildEqAudioGraph()` instead of duplicated per-consumer; verified
   with fake timers in `apps/web/__tests__/eq-track-processor.test.ts`.

**Bug found via the spike, not via reading the types:** `restart()`'s real
call site in `livekit-client` only passes `{ track, kind, element }` — it
never re-passes `audioContext`, even though the `AudioProcessorOptions` type
`restart()` is declared with claims `audioContext` is required. A first
implementation that read `opts.audioContext` inside `restart()` threw
`Cannot read properties of undefined` the moment `LocalAudioTrack.restartTrack()`
ran (see [below](#the-audiocontext-bug)). Fixed by caching the `AudioContext`
handed to `init()` and reusing it on every `restart()`.

## What the spike actually runs

`spikes/livekit-eq-processor/entry.ts` runs entirely client-side against the
real `livekit-client` package — **no `livekit-server` instance involved**.
That's a deliberate scope decision, not a shortcut: all three checklist items
are about the `TrackProcessor`/`LocalAudioTrack` lifecycle, which is pure
client-side plumbing in `livekit-client` (confirmed by reading
`LocalTrack.setMediaStreamTrack`, `LocalAudioTrack.setProcessor`, and
`LocalTrack.restart` in the compiled source) — none of it touches signaling,
a Room, or an SFU connection. Standing up a real `livekit-server --dev`
wasn't possible in the environment this spike ran in anyway (no Docker
daemon, and both `get.livekit.io` and the GitHub releases API were
unreachable through this container's network policy), but that limitation
doesn't weaken the checklist's findings — see
[What this spike does not cover](#what-this-spike-does-not-cover).

The script:

1. Bundles `entry.ts` with esbuild (`platform: browser`, following
   `apps/web/tsconfig.json`'s `@/*` path alias, so it imports
   `eq-track-processor.ts` and `audio-settings.ts` directly — the real
   production files, not copies).
2. Serves the bundle over a throwaway local HTTP server.
3. Launches a real (non-headless-shell) Chromium via Playwright with
   `--use-fake-device-for-media-stream`, grants the `microphone` permission,
   and loads the page.
4. In-page, acquires a fake mic stream, constructs a real
   `new LocalAudioTrack(track, undefined, true, new AudioContext())`, and
   drives it exactly as `apps/web/lib/webrtc/use-voice.ts` would once the
   blocking issue swaps the transport:
   - `track.setProcessor(eqProcessor)` → checklist item 1
   - three `eqProcessor.updateSettings(...)` calls (simulating preset
     switches) with a spy wrapping `eqProcessor.restart` → checklist item 2
   - `track.restartTrack()` (simulating a real device change — this
     re-acquires getUserMedia and swaps the underlying `MediaStreamTrack`,
     which is what actually triggers LiveKit's `processor.restart()`)
   - `eqProcessor.destroy()`
5. Asserts the results with `node:assert`, exits non-zero on failure — same
   convention as `spikes/sqlite-migration`'s scripts.

Current output (`node run.mjs` from `spikes/livekit-eq-processor/`):

```
PASS  local_track_is_real_livekit_instance
PASS  processed_track_exists_after_init
PASS  processed_track_is_live_and_distinct_from_raw
PASS  restart_not_called_by_setProcessor
PASS  restart_not_called_by_updateSettings
PASS  processed_track_unchanged_by_updateSettings
PASS  restart_called_exactly_once_by_restartTrack
PASS  processed_track_rebuilt_after_restart
PASS  processed_track_cleared_after_destroy

All checks passed.
```

## The `audioContext` bug

`livekit-client`'s compiled `LocalTrack.setMediaStreamTrack` (the only place
that ever calls `processor.restart()`):

```js
yield this.processor.restart({
  track: newTrack,
  kind: this.kind,
  element: this.processorElement
});
```

No `audioContext` field. But `restart`'s parameter type is
`AudioProcessorOptions`, which extends `ProcessorOptions<Track.Kind.Audio>`
with `audioContext: AudioContext` — i.e. the *type* promises it's always
there; the real call site doesn't provide it. `init()`'s call site
(`LocalAudioTrack.setProcessor`) does pass it (`audioContext: this.audioContext`),
so the bug only surfaces on the first `restart()`, not on `init()` — exactly
the kind of gap type-checking alone won't catch, and exactly why this spike
ran a real `LocalAudioTrack` instead of stopping at mocked-interface unit
tests.

Fix: `createEqTrackProcessor()` caches the `AudioContext` from `init()`'s
options in a closure variable and reuses it in `restart()`, ignoring
`restart()`'s (absent) `audioContext` field entirely.

## What this spike does not cover

- **No live `livekit-server` round trip.** Nothing here proves
  `RTCRtpSender.replaceTrack()` behaves correctly once the processed track
  flows through an actual publish/subscribe/SFU path, or that perceived
  audio quality holds up over a real network. None of the three checklist
  items require it, but the blocking transport-swap issue should still do
  one manual smoke test against a real room (`livekit-server --dev` or
  LiveKit Cloud) before shipping, purely as an end-to-end sanity check.
- **No mid-call slider-drag "feel" test.** `updateSettings` is proven not to
  call `restart()` and to mutate the right `AudioParam`s, but nobody's ears
  were in the loop — worth a quick manual pass once this lands in the real
  UI.

## Recommendation for the blocking issue

Use `createEqTrackProcessor()` as-is (`apps/web/lib/voice/eq-track-processor.ts`).
Wire it up in `apps/web/lib/webrtc/use-voice.ts`'s LiveKit replacement via:

```ts
const processor = createEqTrackProcessor(audioSettings)
await localAudioTrack.setProcessor(processor)
// ...on every settings change instead of tearing down the whole pipeline:
processor.updateSettings(audioSettings)
```

which is a meaningfully cheaper update path than the current P2P code's
full pipeline teardown/rebuild on every settings change (see the effect in
`use-voice.ts` that calls `createInputAudioPipeline` fresh each time
`audioSettings` changes) — LiveKit's version never needs to touch
`RTCRtpSender.replaceTrack()` for a parameter tweak at all.
