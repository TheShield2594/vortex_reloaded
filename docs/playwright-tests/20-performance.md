# 20 — Performance

> Covers: page load times, Core Web Vitals, lazy loading, bundle size, realtime message throughput, search latency, image optimization.

---

## 20.1 Page Load & Core Web Vitals

### `page-load.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should load login page < 2s | Navigate → measure | LCP < 2000ms |
| 2 | should load channel page < 3s | Navigate to channel → measure | LCP < 3000ms |
| 3 | should load DM page < 3s | Navigate to DM → measure | LCP < 3000ms |
| 4 | should load discover page < 3s | Navigate → measure | LCP < 3000ms |
| 5 | should load settings page < 2s | Navigate → measure | LCP < 2000ms |
| 6 | should achieve CLS < 0.1 | Navigate + wait | CLS < 0.1 |
| 7 | should achieve INP ≤ 200ms | Interact → measure | INP ≤ 200ms |
| 8 | should achieve TTFB < 800ms | Request → measure | TTFB < 800ms |

---

## 20.2 Lazy Loading & Code Splitting

### `lazy-loading.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should lazy load voice channel component | Navigate without voice | Voice bundle not loaded |
| 2 | should load voice bundle on demand | Click voice channel | Bundle loads dynamically |
| 3 | should lazy load emoji picker | Page load | Picker bundle not loaded initially |
| 4 | should load emoji picker on trigger | Click emoji button | Picker loads |
| 5 | should lazy load settings pages | Navigate to `/channels` | Settings bundle not loaded |
| 6 | should lazy load moderation tools | Navigate to channel | Moderation bundle not loaded |

---

## 20.3 Message Rendering Performance

### `message-performance.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should render 100 messages < 500ms | Load channel with 100 messages | Render time < 500ms |
| 2 | should handle infinite scroll smoothly | Scroll up to load history | No jank; FPS > 30 |
| 3 | should virtualize long message lists | 1000+ messages | Only visible messages in DOM |
| 4 | should handle rapid message arrival | Receive 50 messages/second | No freezing |
| 5 | should not re-render all messages on new message | Receive 1 new message | Only new message rendered |

---

## 20.4 Search Performance

### `search-performance.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should return search results < 1s | Search query → measure | Response < 1000ms |
| 2 | should debounce search input | Type rapidly | API called once after typing stops |
| 3 | should not block UI during search | Search → interact with page | UI remains responsive |

---

## 20.5 Image & Media Optimization

### `media-optimization.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should lazy load images below fold | Load page | Below-fold images use `loading="lazy"` |
| 2 | should show image placeholders while loading | Load page with images | Placeholder/skeleton shown |
| 3 | should use appropriate image sizes | Check img elements | Responsive `srcset` or constrained dimensions |
| 4 | should cache CDN assets | Request same asset twice | Second request from cache |

---

## 20.6 Realtime Performance

### `realtime-performance.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should receive message < 200ms after send | Send message → measure receive time | < 200ms latency |
| 2 | should handle 100 concurrent subscriptions | Subscribe to 100 channels | All subscriptions active |
| 3 | should reconnect within 5s after disconnect | Simulate disconnect | Reconnected < 5s |
| 4 | should not leak subscriptions | Navigate between channels | Old subscriptions cleaned up |

---

## 20.7 Memory & Resource Leaks

### `resource-leaks.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should not leak memory on navigation | Navigate 50 times → check heap | Heap size stable |
| 2 | should clean up event listeners on unmount | Navigate away from voice | No orphaned listeners |
| 3 | should clean up WebSocket connections | Navigate away | Connections closed |
| 4 | should clean up timers and intervals | Navigate away | No orphaned timers |
