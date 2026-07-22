# 15 — PWA & Mobile

> Covers: PWA install, service worker, offline mode, connection state machine, message outbox, mobile tab bar, mobile navigation, back-button handling, splash screen, skeleton screens, SW update detection, iOS splash screens, app badge.

**Components under test:**
- `pwa-install-banner.tsx`, `connection-banner.tsx`, `splash-screen.tsx`
- `sw-update-toast.tsx`, `mobile-bottom-tab-bar.tsx`, `mobile-nav.tsx`
- `server-mobile-layout.tsx`
- Hooks: `use-connection-status.ts`, `use-sw-registration.ts`, `use-mobile-layout.ts`
- Hooks: `use-tab-unread-title.ts`, `use-keyboard-avoidance.ts`, `use-pull-to-refresh.ts`
- Hooks: `use-swipe.ts`, `use-reduced-motion.ts`
- Pages: `offline/page.tsx`
- Files: `manifest.json`, `sw.js`

---

## 15.1 PWA Installation

### `pwa-install.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show install banner | Visit app in compatible browser | Install prompt/banner shown |
| 2 | should have valid manifest.json | Fetch `/manifest.json` | Valid name, icons, start_url, display |
| 3 | should have correct theme color | Check manifest | Theme color set |
| 4 | should have correct display mode | Check manifest | `display: standalone` |
| 5 | should dismiss install banner | Click dismiss | Banner hidden |

---

## 15.2 Service Worker

### `service-worker.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should register service worker | Page load | SW registered |
| 2 | should cache assets with correct strategy | Network → check cache | Multi-strategy caching active |
| 3 | should detect SW update | Deploy new version → wait for poll | "New version available" toast |
| 4 | should poll hourly for updates | Use fake timers / injected interval; advance clock | Polling callback fires at expected cadence |
| 5 | should update on toast action | Click "Update" on toast | SW activates new version; page reloads |
| 6 | should handle SW registration failure | Mock registration error | Graceful degradation |

---

## 15.3 Offline Mode

### `offline-mode.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show offline banner when disconnected | Simulate network loss | Color-coded "Offline" banner |
| 2 | should show reconnecting state | Network lost → attempting reconnect | "Reconnecting..." banner |
| 3 | should show connected state on recovery | Network restored | Banner disappears |
| 4 | should follow FSM transitions | offline → reconnecting → connected | Correct state transitions |
| 5 | should show offline page | Navigate while offline | `/offline` page |
| 6 | should color-code banner states | View different states | Different colors per state |

### `message-outbox.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should queue message when offline | Go offline → send message | Message queued locally |
| 2 | should persist outbox in localStorage | Queue message → reload | Message still in outbox |
| 3 | should flush outbox on reconnect | Go offline → send → go online | Queued messages sent |
| 4 | should show pending indicator on queued messages | View queued message | "Sending..." indicator |
| 5 | should handle flush failure | Reconnect → server error on send | Retry or error state |

---

## 15.4 Mobile Bottom Tab Bar

### `mobile-tab-bar.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show 4-tab pill nav on mobile | Mobile viewport | Tab bar with 4 tabs |
| 2 | should navigate between tabs | Tap each tab | Correct page loads |
| 3 | should highlight active tab | View current tab | Active tab highlighted |
| 4 | should show unread indicators on tabs | Receive notification | Badge on relevant tab |
| 5 | should hide on desktop | Desktop viewport | Tab bar not shown |
| 6 | should not show drawer (removed) | Mobile viewport | No slide-out drawer |

---

## 15.5 Mobile Navigation

### `mobile-navigation.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should handle back button correctly | Navigate deep → press back | Returns to previous view |
| 2 | should prevent PWA exit on back | At root → press back | History stack prevents exit |
| 3 | should maintain two-entry history stack | Navigate → check stack | Two entries maintained |
| 4 | should hide server sidebar on mobile | Mobile viewport | Server sidebar hidden (desktop-only) |
| 5 | should show servers page instead | Mobile → navigate to servers | Segmented control with My Servers / Discover |

---

## 15.6 Splash Screen & Skeleton

### `splash-skeleton.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show branded splash on load | Fresh page load | Splash screen with branding |
| 2 | should show shimmer skeleton while loading | View loading state | Shimmer animation on placeholders |
| 3 | should respect reduced-motion preference | Set `prefers-reduced-motion: reduce` | No shimmer animation |
| 4 | should transition to content | Content loads | Splash → content smoothly |

---

## 15.7 iOS Specific

### `ios-specifics.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should have iOS splash screens | Check `<link rel="apple-touch-startup-image">` | 8 device sizes defined |
| 2 | should have apple-touch-icon | Check `<link rel="apple-touch-icon">` | Icon present |
| 3 | should set viewport-fit=cover | Check viewport meta | `viewport-fit=cover` present |
| 4 | should set interactive-widget=resizes-content | Check viewport meta | Present |
| 5 | should disable telephone format detection | Check meta | `format-detection: telephone=no` |
| 6 | should handle safe-area insets | Check CSS | `env(safe-area-inset-*)` used |

---

## 15.8 Input Handling on Mobile

### `mobile-input.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should set inputmode="search" on search fields | Inspect search inputs | `inputmode="search"` |
| 2 | should set inputmode="email" on email fields | Inspect email inputs | `inputmode="email"` |
| 3 | should set inputmode="numeric" on number fields | Inspect number inputs | `inputmode="numeric"` |
| 4 | should handle keyboard avoidance | Focus input on mobile | Content adjusts for keyboard |
| 5 | should support pull-to-refresh | Pull down gesture | Content refreshes |
| 6 | should support swipe gestures | Swipe left/right | Navigation action |

---

## 15.9 App Badge

### `app-badge.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should call setAppBadge on unread mentions | Receive mention | `navigator.setAppBadge()` called |
| 2 | should clear badge when all read | Mark all read | `navigator.clearAppBadge()` called |
| 3 | should update tab title | Receive 3 unreads | Tab title shows "(3) VortexChat" |
| 4 | should handle badge API not available | Non-supporting browser | Graceful fallback |
