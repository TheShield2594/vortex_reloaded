# LiveKit EQ TrackProcessor spike (issue #11)

Proves out wrapping the existing Web Audio EQ pipeline
(`apps/web/lib/voice/audio-pipeline.ts`) in a LiveKit `TrackProcessor` before
the token-mint/media-transport swap issue wires it into the live call path.

Findings write-up: `docs/livekit-eq-track-processor-spike.md`.

Unlike `spikes/sqlite-migration`, this isn't isolated from the app's
dependency tree — it deliberately imports the real
`apps/web/lib/voice/eq-track-processor.ts` and the real `livekit-client`
package (already a pinned `apps/web` dependency) so the spike is testing
production code, not a rewritten stand-in. Run `npm install` at the repo
root first if you haven't (this workspace uses npm workspaces; `livekit-client`,
`esbuild`, and `playwright` all resolve from the hoisted root
`node_modules`).

## Setup

```bash
npm install   # from the repo root
```

## Run

```bash
cd spikes/livekit-eq-processor
node run.mjs
```

`entry.ts` is bundled with esbuild into a single browser script, served over
a throwaway local HTTP server, and driven by a real (not headless-shell)
Chromium launched with `--use-fake-device-for-media-stream` — no real
microphone or `livekit-server` instance needed. It exercises the actual
`livekit-client` `LocalAudioTrack.setProcessor()` / `.restartTrack()` /
processor lifecycle against `createEqTrackProcessor()`, and asserts its
expectations with `node:assert`, exiting non-zero on failure — same
convention as the sqlite-migration spike's scripts.
