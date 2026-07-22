# 05 — Voice & WebRTC

> Covers: voice channel join/leave, mute/deafen, screen share, voice grid layout, compact voice bar, voice stats, voice consent, voice recording/transcription/summary, voice settings, WebRTC signaling.

**Components under test:**
- `voice-channel.tsx`, `voice-channel-lazy.tsx`, `compact-voice-bar.tsx`
- `voice-grid-layout.tsx`, `voice-stats-overlay.tsx`, `voice-consent-modal.tsx`
- `voice-transcript-viewer.tsx`, `voice-summary-card.tsx`, `voice-recap-card.tsx`
- `vortex-recap-indicator.tsx`, `incoming-call-ui.tsx`
- `voice-settings-page.tsx` (settings)
- Hooks: `use-push-to-talk.ts`, `use-voice.ts` (referenced in project)
- API: `/api/servers/[serverId]/channels/[channelId]/voice-token`
- API: `/api/voice/sessions`, `/api/voice/sessions/[id]/consent`, `/api/voice/sessions/[id]/end`
- API: `/api/voice/sessions/[id]/transcript`, `/api/voice/sessions/[id]/summary`
- API: `/api/voice/sessions/[id]/subtitle-preferences`
- API: `/api/servers/[serverId]/voice-intelligence-policy`
- Cron: `/api/cron/voice-retention`

---

## 5.1 Joining & Leaving Voice Channels

### `voice-join-leave.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should join voice channel on click | Click voice channel in sidebar | Connected; voice UI shown; compact bar appears |
| 2 | should show connected users in voice channel | Join channel | Other participants visible |
| 3 | should leave voice channel | Click disconnect/leave button | Disconnected; UI closes |
| 4 | should automatically clean up on page navigation | Join voice → navigate away | Properly disconnects |
| 5 | should show voice channel in sidebar with participant count | Users join | "(2)" count shown |
| 6 | should only join one voice channel at a time | Join channel A → click channel B | Leaves A, joins B |
| 7 | should reconnect after network disruption | Simulate brief disconnect | Auto-reconnects |
| 8 | should require CONNECT permission for voice | Login as restricted user → try join | Join blocked |

---

## 5.2 Voice Controls

### `voice-controls.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should mute microphone | Click mute toggle | Mic icon crossed out; audio stops transmitting |
| 2 | should unmute microphone | Click mute toggle again | Mic active; audio resumes |
| 3 | should deafen (mute all incoming audio) | Click deafen toggle | Speaker icon crossed; all audio muted |
| 4 | should undeafen | Click deafen again | Audio restored |
| 5 | should mute when deafening (auto-mute) | Click deafen while unmuted | Both mic and audio muted |
| 6 | should show speaking indicator | User speaks | Green border/glow on avatar |
| 7 | should show muted indicator to others | User A mutes | Other users see mute icon on A |
| 8 | should show deafened indicator to others | User A deafens | Others see deafen icon on A |

### `push-to-talk.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should enable push-to-talk in settings | Voice settings → PTT → enable | PTT mode active |
| 2 | should transmit only while key held | Hold PTT key → speak → release | Audio only during hold |
| 3 | should show PTT indicator | Hold key | Visual indicator shown |
| 4 | should configure PTT keybind | Settings → change key | New key works |

---

## 5.3 Screen Sharing

### `screen-share.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should start screen share | Click screen share button | Screen selection dialog → sharing starts |
| 2 | should show screen share to other participants | User A shares → User B sees | Screen content visible in grid |
| 3 | should stop screen share | Click stop sharing | Screen share ends |
| 4 | should include system audio option | Start share | "Share system audio" checkbox available |
| 5 | should forward system audio to peers | Share with audio → User B listens | Audio track forwarded |
| 6 | should handle share cancellation | Cancel screen selection dialog | Returns to normal state |
| 7 | should show screen share in grid layout | Share screen | Dedicated grid tile for screen |

---

## 5.4 Voice Grid Layout

### `voice-grid-layout.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show grid with 2 participants | 2 users join | 2-tile grid |
| 2 | should adjust grid for 4 participants | 4 users join | 2x2 grid |
| 3 | should adjust grid for 9 participants | 9 users join | 3x3 grid |
| 4 | should highlight active speaker | User speaks | Their tile emphasized |
| 5 | should show username under each tile | View grid | Names visible |
| 6 | should show avatar when camera is off | Join with camera off | Avatar shown in tile |

---

## 5.5 Compact Voice Bar

### `compact-voice-bar.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show compact bar when in voice | Join voice channel → navigate to text channel | Compact bar visible at bottom |
| 2 | should show current voice channel name | View bar | Channel name displayed |
| 3 | should show mute/deafen controls in bar | View bar | Control buttons present |
| 4 | should show disconnect button | View bar | Leave/disconnect button |
| 5 | should expand to full voice view on click | Click bar | Full voice UI opens |

---

## 5.6 Voice Intelligence (Transcripts, Summaries, Recaps)

### `voice-intelligence.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show consent modal on first join with recording | Join channel with recording enabled | Consent modal shown |
| 2 | should save consent preference | Accept consent | Preference persisted |
| 3 | should view transcript after voice session | End session → view transcript | Transcript displayed |
| 4 | should view session summary | End session → view summary | AI summary shown |
| 5 | should configure voice intelligence policy | Server settings → Voice Intelligence | Policy options shown |
| 6 | should show recap indicator during recording | Active recording | Recap indicator visible |
| 7 | should set subtitle preferences | Toggle subtitles → set language | Preference saved |
| 8 | should show voice recap card | View post-session | Recap card with stats |

---

## 5.7 Voice Settings

### `voice-settings.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should select input device | Settings → Voice → Input Device dropdown | Device selected |
| 2 | should select output device | Output Device dropdown | Device selected |
| 3 | should adjust input volume | Move volume slider | Volume changes |
| 4 | should test microphone | Click "Test Mic" | Audio loopback or level meter |
| 5 | should toggle noise suppression | Enable/disable noise suppression | Setting saved |
| 6 | should toggle echo cancellation | Enable/disable | Setting saved |
| 7 | should toggle automatic gain control | Enable/disable | Setting saved |
| 8 | should persist settings across sessions | Change settings → reload | Settings retained |

---

## 5.8 WebRTC Signaling

### `webrtc-signaling.spec.ts`

> These tests verify Socket.IO signaling events. Use mock Socket.IO or intercept WebSocket frames.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should authenticate on socket connection | Connect to signal server | Auth token validated |
| 2 | should exchange SDP offer/answer | User A joins → User B joins | SDP exchange occurs |
| 3 | should exchange ICE candidates | Peer connection establishing | ICE candidates forwarded |
| 4 | should handle peer disconnect | User B leaves | User A notified; cleans up |
| 5 | should validate signaling message fields | Send malformed signal | Message rejected |
| 6 | should clean up room membership on disconnect | Socket disconnects | User removed from voice room |
| 7 | should re-validate auth on sensitive events | Emit event after token expiry | Event rejected |
