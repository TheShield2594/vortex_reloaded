# Bundle Analysis Report — VortexChat Web

Generated via `ANALYZE=true npm run build:analyze` on 2026-03-07.
Reports saved to `apps/web/.next/analyze/nodejs.html` (server) and `edge.html` (middleware).

---

## Server-Bundle Chunks Exceeding 50 KB (parsed, unminified)

| Chunk | Parsed | Gzip | Primary contents |
|---|---|---|---|
| `1481.js` | **1,220 KB** | 382 KB | `@sentry/nextjs` + `@opentelemetry/*` (server SDK) |
| `1031.js` | **1,077 KB** | 338 KB | `@sentry/nextjs` duplicate init chunk (Next.js edge/server split) |
| `channels/[serverId]/[channelId]/page.js` | **732 KB** | 194 KB | Channel page + inlined shared deps |
| `2014.js` | **179 KB** | 47 KB | `@supabase/ssr` + `@supabase/supabase-js` |
| `index.js + 45 modules` | **173 KB** | 45 KB | `@supabase/supabase-js` dist |
| `2541.js` | **165 KB** | 42 KB | `@supabase/supabase-js` (auth module) |
| `286.js` | **127 KB** | 30 KB | Shared UI components (Radix + lucide-react) |
| `4177.js` | **124 KB** | 40 KB | `next/dist` runtime |
| `2460.js` | **111 KB** | 34 KB | Sentry integrations / tracing helpers |
| `voice-token/route.js` | **97 KB** | 27 KB | `livekit-server-sdk` (server-side JWT only) |
| `5183.js` | **94 KB** | 32 KB | Sentry OpenTelemetry bridge |
| `_error.js` | **78 KB** | 24 KB | Next.js error boundary |
| `2482.js` | **69 KB** | 19 KB | Shared form/modal components |
| `5321.js` | **67 KB** | 18 KB | Radix UI primitives |
| `7881.js` | **61 KB** | 13 KB | zustand + date-fns |
| `channels/me/[channelId]/page.js` | **59 KB** | 18 KB | DM channel page |

---

## Findings

### @sentry/nextjs — **confirmed bloat** ⚠️

`@sentry/nextjs` is the dominant contributor:
- Chunks `1481.js` (1.2 MB) and `1031.js` (1.1 MB) are **both Sentry** — the SDK is
  split across a server-init chunk and a shared instrumentation chunk, totalling
  **~2.3 MB parsed / ~720 KB gzip** on the server side.
- `@opentelemetry/*` (317 KB) is pulled in transitively by Sentry and is fully
  included in the server bundle even for routes that never emit traces.
- Root cause: `autoInstrumentServerFunctions: true` causes Sentry to wrap every
  route, preventing dead-code elimination of the telemetry pipeline.

**Recommendations:**
1. Set `autoInstrumentServerFunctions: false` and instrument only high-value routes
   manually with `withSentry()`.
2. Use `Sentry.init({ integrations: [] })` to opt-out of the OpenTelemetry
   performance integrations in environments that don't need them (i.e. preview
   branches).
3. Ensure `sentry.server.config.ts` content is moved into `instrumentation.ts`
   (`register()`) as recommended by the Sentry deprecation warning — this allows
   the bundler to tree-shake unused init paths.

### livekit-client — **not causing bloat** ✅

`livekit-client` (the browser WebRTC SDK) does **not** appear in the server or
middleware bundles. The only LiveKit code on the server is `livekit-server-sdk` in
the voice-token API route (97 KB), which is correct — that route generates access
tokens and must be server-side.

On the client side the build was interrupted before static chunk generation
(Google Fonts unreachable in sandbox), but the import pattern in
`use-livekit-voice.ts` is a direct import with no dynamic() wrapper, meaning
`livekit-client` will land in the initial JS payload for the channel page.
**Recommendation:** wrap the hook's LiveKit import in `dynamic(() => import(...), { ssr: false })`
so the ~600 KB LiveKit client SDK is only fetched when the user actually joins a
voice channel.

---

## How to reproduce

```bash
# from repo root
npm run build:analyze --workspace=apps/web
# opens .next/analyze/nodejs.html and .next/analyze/edge.html in your browser
```
