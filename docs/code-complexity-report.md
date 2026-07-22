# Code Complexity Analysis Report

Date: 2026-02-26  
Repository: `vortexchat`

## Method used

- Static scan of TypeScript/TSX source for:
  - file LOC and function LOC,
  - estimated cyclomatic complexity (`1 + decision points`) using keyword heuristics,
  - import graph proxies for afferent/efferent coupling and instability index.
- Spot-reviewed high-risk files/functions for nested branches and mixed abstraction.

> **Important:** cyclomatic and cognitive scores below are **estimates** (heuristic, not compiler AST metrics). For audit-grade values, wire an AST-based analyzer (ESLint `complexity`, SonarJS cognitive complexity).

---

## Remediation update (implemented)

Completed in this cycle:

- Refactored `POST` in `apps/web/app/api/messages/route.ts` by extracting the AutoMod decisioning flow into `runServerAutomodChecks`, reducing nested branch depth in the route handler and isolating policy/audit logic.
- Extracted message persistence + attachment insertion into `insertMessageWithAttachments` so the route orchestration path is smaller and easier to reason about/test.
- Extracted request-shape validation for `POST` into `parsePostMessageRequestBody` to reduce inline branching and keep the handler focused on orchestration.
- Extracted `GET` route concerns into focused helpers (`getChannelForRead`, `getMessagesAroundTarget`) to isolate permission/context-window logic from top-level endpoint flow.
- Preserved existing behavior for idempotency, moderation outcomes, audit logging, and notification flow; only responsibility boundaries changed.

Additional remediation completed across the previously listed hotspots:

- `useVoice`: extracted repeated peer teardown into `removePeerConnection` to centralize stale/leave cleanup behavior.
- `ChatArea`: extracted repeated composer reset behavior into `resetComposerState` to reduce duplicated side-effect branches in send flow.
- `DMChannelArea`: extracted DM message POST plumbing into `sendDmPayload` for reuse across text and file-send paths.
- `ChannelSidebar`: extracted thread-count fetching and voice-state normalization into dedicated helpers (`fetchThreadCounts`, `normalizeVoiceParticipants`).
- `AutoModTab` (`server-settings-modal.tsx`): extracted upsert branching into `upsertAutomodRule` to simplify save-path state updates.
- `POST` follow-up in `messages/route.ts`: extracted `resolveSafeMentions`, `enforceServerMessagingGuards`, and `enforceSlowmode` to further shrink inline guard/validation branching in the endpoint.

---

## 1) Cyclomatic complexity findings

### High complexity functions (estimated > 10)

| Identifier | Location | Est. Cyclomatic | Notes |
|---|---:|---:|---|
| `POST` | `apps/web/app/api/messages/route.ts` | ~132 | Single handler contains auth, validation, rate limit, moderation, persistence, notifications. |
| `GET` | `apps/web/app/api/messages/route.ts` | ~27 | Contains two query modes (`around` context window vs regular pagination) and repeated branching. |
| `useVoice` | `apps/web/lib/webrtc/use-voice.ts` | ~223 | Very large hook coordinating media, signaling, reconnection, and UI state. |
| `ChatArea` | `apps/web/components/chat/chat-area.tsx` | ~285 | Consolidates outbox, optimistic updates, message history, realtime and scroll behavior. |
| `DMChannelArea` | `apps/web/components/dm/dm-channel-area.tsx` | ~192 | Handles chat + call UI + side effects in one component. |
| `ChannelSidebar` | `apps/web/components/layout/channel-sidebar.tsx` | ~109 | Navigation state, filtering, drag/sort, rendering all in one component. |
| `AutoModTab` | `apps/web/components/modals/server-settings-modal.tsx` | ~53 | Form shaping, validation, mutation, priority reordering together. |

### Nested if/else depth

- `useVoice` reaches ~6 nested levels in reconnection/signaling pathways, especially around peer lifecycle and `oniceconnectionstatechange`.  
- `POST` in messages route has multiple 3+ nested segments (permissions/screening/timeout, automod, duplicate-idempotency fallback).  
- `ChatArea` and `DMChannelArea` stack UI state effects + async conditionals, increasing branching overhead.

### Switch complexity

- `useVoice` has a focused switch on ICE states with 4 cases (`connected/completed/disconnected/failed/closed`) and internal branching in each case; complexity impact is moderate but acceptable in isolation.  
- No single large `switch` block appears to be the primary risk compared to long, branch-heavy async functions.

### Cyclomatic remediation (drop-in direction)

#### Target: `POST` handler split into pipeline helpers

```ts
// apps/web/app/api/messages/route.ts
async function validateMessageRequest(body: unknown) { /* existing lines 140-196 */ }
async function enforceMessagingGuards(ctx: MessageContext) { /* perms/screening/timeout/slowmode */ }
async function runAutomod(ctx: MessageContext) { /* existing automod block */ }
async function persistMessage(ctx: MessageContext) { /* insert + duplicate nonce fallback */ }
async function enqueueNotifications(ctx: MessageContext) { /* fire-and-forget block */ }

export async function POST(request: Request) {
  const ctx = await buildMessageContext(request)
  await enforceMessagingGuards(ctx)
  await runAutomod(ctx)
  const message = await persistMessage(ctx)
  enqueueNotifications({ ...ctx, message })
  return NextResponse.json(message, { status: 201 })
}
```

---

## 2) Cognitive complexity findings

### Primary understandability hotspots

1. **`useVoice` mixes many abstraction levels** in one hook:
   - transport/signaling protocol,
   - audio device and processing pipeline,
   - retry/backoff state machine,
   - UI-facing React state.  
   This raises mental load because business intent and transport internals are interleaved.

2. **`ChatArea` is a “god component”**:
   - optimistic queue semantics,
   - history pagination/context window,
   - realtime subscriptions,
   - editor/draft persistence and scroll management.

3. **`POST` route has policy + orchestration + I/O all inline**:
   - difficult to unit-test logic boundaries,
   - high branch count makes failure-mode reasoning expensive.

### Recursive calls

- **Unable to verify any meaningful recursion hotspots** in scanned TS/TSX sources; no clear self-recursive functions found.
- Code that would prove otherwise: explicit self-calls in core modules/hook helpers.

### Cognitive remediation (drop-in direction)

- Extract hooks/modules by responsibility:
  - `useVoiceSignaling(channelId, userId)`
  - `useVoiceMedia(audioSettings)`
  - `useVoiceReconnect(peerConnections)`
  - `useChatOutbox(channelId)`
  - `useChatHistory(channelId)`
- Keep top-level components/hooks as orchestration shells only.

---

## 3) LOC metrics

### Functions over 50 lines (sampled high-risk)

| Identifier | File | Approx LOC |
|---|---|---:|
| `POST` | `apps/web/app/api/messages/route.ts` | 491 |
| `GET` | `apps/web/app/api/messages/route.ts` | 101 |
| `useVoice` | `apps/web/lib/webrtc/use-voice.ts` | 1041 |
| `ChatArea` | `apps/web/components/chat/chat-area.tsx` | 1367 |
| `DMChannelArea` | `apps/web/components/dm/dm-channel-area.tsx` | 800 |
| `ChannelSidebar` | `apps/web/components/layout/channel-sidebar.tsx` | 642 |
| `AutoModTab` | `apps/web/components/modals/server-settings-modal.tsx` | 454 |

### Files over 300 lines (top examples)

- `apps/web/components/modals/server-settings-modal.tsx` (2014 lines)
- `apps/web/types/database.ts` (1883 lines)
- `apps/web/components/chat/chat-area.tsx` (1433 lines)
- `apps/web/components/dm/dm-channel-area.tsx` (1196 lines)
- `apps/web/lib/webrtc/use-voice.ts` (1182 lines)
- `apps/web/components/layout/channel-sidebar.tsx` (1093 lines)
- `apps/web/components/chat/message-item.tsx` (927 lines)

### Classes over 500 lines

- **None found** in scanned TS code.
- Existing classes are small (`RoomManager`, `AppInteractionRuntime`, `RateLimiter`) and below 100 lines.

### LOC remediation

- Split `server-settings-modal.tsx` into per-tab files (UI + hooks).
- Split `chat-area.tsx` into composable hooks (`outbox`, `history`, `subscriptions`, `drafts`).
- Keep generated-type file (`types/database.ts`) as-is, but isolate generated artifacts in dedicated folder if needed for maintainability.

---

## 4) Coupling metrics

> Proxies computed from local import graph in `apps/web` (including `@/` alias resolution).

### High afferent coupling (Ca: many depend on it)

| Module/file | Ca | Ce | Instability `I=Ce/(Ce+Ca)` | Interpretation |
|---|---:|---:|---:|---|
| `apps/web/lib/supabase/server.ts` | 93 | 1 | 0.01 | Very stable core dependency; high blast radius on change. |
| `apps/web/types/database.ts` | 43 | 0 | 0.00 | Pure foundational type dependency. |
| `apps/web/lib/supabase/client.ts` | 31 | 1 | 0.03 | Another stable platform dependency. |

### High efferent coupling (Ce: depends on many modules)

| Module/file | Ce | Ca | Instability | Interpretation |
|---|---:|---:|---:|---|
| `apps/web/components/layout/channel-sidebar.tsx` | 19 | 1 | 0.95 | Highly volatile consumer, broad dependency surface. |
| `apps/web/components/chat/chat-area.tsx` | 15 | 1 | 0.94 | Highly coupled orchestration component. |
| `apps/web/components/chat/message-item.tsx` | 14 | 5 | 0.74 | Cross-cutting render unit with many dependencies. |
| `apps/web/components/dm/dm-channel-area.tsx` | 11 | 1 | 0.92 | Broad consumer with low reuse. |

### Coupling remediation

- Introduce **facade modules** for domain actions (e.g., `chat-service.ts`, `voice-service.ts`) so large components import fewer direct dependencies.
- Prefer dependency inversion for side-effect clients (`supabase`, push, upload) via injected adapters/hooks.

---

## 5) Cohesion analysis

### Observations

- **Low cohesion hotspots**: `useVoice`, `ChatArea`, `DMChannelArea`, `ChannelSidebar` each bundle transport/state/storage/render/event logic.
- **Single responsibility drift**: `POST /api/messages` handles both policy decisioning and delivery side effects (notifications/push).
- **Clear cohesion area**: utility modules (e.g., permission helpers, lightweight libs) are relatively focused compared to large UI/route files.

### Cohesion remediation

- Apply vertical slicing by use-case:
  - `messages/guards.ts`, `messages/automod.ts`, `messages/persist.ts`, `messages/notify.ts`.
- For UI, push side-effectful logic into hooks and keep component bodies mostly declarative JSX.

---

## Structured findings (priority scored 1-10)

| # | Finding | Importance (1-10) | Evidence | Remediation |
|---|---|---:|---|---|
| 1 | `POST` handler is over-complex and multi-responsibility | **10** | `apps/web/app/api/messages/route.ts` (`POST`, lines 135-625) | Extract guard/automod/persist/notify helpers; unit-test each helper in isolation. |
| 2 | `useVoice` hook is a monolith with high branch/load | **10** | `apps/web/lib/webrtc/use-voice.ts` (`useVoice`, lines 142-1182) | Split signaling/media/reconnect into dedicated hooks; keep `useVoice` as orchestrator. |
| 3 | `ChatArea` is an oversized orchestration component | **9** | `apps/web/components/chat/chat-area.tsx` (`ChatArea`, lines 67-1433) | Move outbox/history/realtime/draft behavior to hooks; reduce direct imports in UI component. |
| 4 | `DMChannelArea` mixes chat and call responsibilities | **8** | `apps/web/components/dm/dm-channel-area.tsx` (`DMChannelArea`, lines 137-936) | Split call-specific pane/controller from message timeline controller. |
| 5 | `server-settings-modal.tsx` has tab-level complexity concentration | **8** | `apps/web/components/modals/server-settings-modal.tsx` (`AutoModTab` lines 1280-1733; file 2014 LOC) | Move each tab to file + colocated hook; keep modal shell thin. |
| 6 | High fan-out in sidebar/chat components increases change risk | **7** | `channel-sidebar.tsx` Ce=19, `chat-area.tsx` Ce=15 | Add domain facades and aggregate hooks to reduce direct dependency count. |
| 7 | Critical infra modules have high fan-in (blast radius) | **7** | `lib/supabase/server.ts` Ca=93; `types/database.ts` Ca=43 | Lock APIs behind stable wrappers; enforce stricter review/testing on these files. |
| 8 | File-size sprawl (>300 LOC, many >1000 LOC) hurts maintainability | **8** | multiple files exceed 300 lines, including 2014/1433/1196/1182 LOC | Set lint guardrails (max-lines, max-lines-per-function) with staged thresholds. |

---

## Suggested config guardrails

```js
// apps/web/eslint.config.mjs (conceptual)
rules: {
  "complexity": ["warn", 12],
  "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
  "sonarjs/cognitive-complexity": ["warn", 20]
}
```

If SonarJS plugin is not installed, add it before enabling the cognitive-complexity rule.
