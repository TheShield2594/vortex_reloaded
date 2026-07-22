# VortexChat — Playwright Test Documentation

> Comprehensive E2E test specifications covering every feature, API route, component, and user flow in VortexChat.

## Test Suite Overview

| # | Document | Area | Est. Tests |
|---|----------|------|-----------|
| [00](./00-setup-and-conventions.md) | Setup & Conventions | Config, fixtures, naming, VS Code integration | — |
| [01](./01-authentication.md) | Authentication & Account Security | Login, register, MFA, passkeys, sessions, CSRF | ~65 |
| [02](./02-server-management.md) | Server Management | CRUD, settings, templates, invites, vanity URLs, members | ~55 |
| [03](./03-channels-and-messaging.md) | Channels & Messaging | Channel types, messages, reactions, emoji, GIF, stickers, mentions, replies, pins, markdown | ~110 |
| [04](./04-direct-messages.md) | Direct Messages | DM list, messaging, reactions, pickers, calls, attachments, encryption, friends | ~55 |
| [05](./05-voice-and-webrtc.md) | Voice & WebRTC | Join/leave, controls, screen share, grid, voice intelligence, settings, signaling | ~55 |
| [06](./06-moderation.md) | Moderation & AutoMod | Ban, kick, timeout, audit log, AutoMod, screening, reports, appeals | ~65 |
| [07](./07-roles-and-permissions.md) | Roles & Permissions | Role CRUD, assignment, hierarchy, enforcement, channel overrides, sandbox | ~40 |
| [08](./08-search-and-discovery.md) | Search & Discovery | Message search, quickswitcher, server/app discover, friend suggestions | ~30 |
| [09](./09-notifications.md) | Notifications | Bell, hub, push, settings, quiet hours, unread indicators, sounds, badges | ~40 |
| [10](./10-user-settings.md) | User Settings | Profile, appearance, accessibility, keybinds, connections | ~40 |
| [11](./11-app-store-and-bots.md) | App Store & Bots | Catalog, Welcome/Giveaway/Standup/Incident/Reminder bots, slash commands | ~60 |
| [12](./12-media-and-attachments.md) | Media & Attachments | Upload, lightbox, video, audio, download, decay, web share | ~35 |
| [13](./13-profile-and-badges.md) | Profile & Badges | Profile panel, popover, badges, activity, pins, interests, presence | ~35 |
| [14](./14-onboarding.md) | Onboarding | Welcome screen, server creation, empty states, onboarding gate | ~20 |
| [15](./15-pwa-and-mobile.md) | PWA & Mobile | Install, SW, offline, outbox, tab bar, navigation, splash, iOS, input, badge | ~45 |
| [16](./16-security.md) | Security & Data Protection | XSS, CSRF, body limits, input validation, health, proxy, session, data protection | ~40 |
| [17](./17-threads.md) | Threads | Create, messaging, panel, list, auto-archive, members | ~30 |
| [18](./18-events-and-calendar.md) | Events & Calendar | Create, RSVP, calendar, cards, iCal, reminders | ~25 |
| [19](./19-accessibility.md) | Accessibility | Screen reader, keyboard nav, focus, contrast, reduced motion, axe scans | ~50 |
| [20](./20-performance.md) | Performance | Page load, lazy loading, message rendering, search, media, realtime, memory | ~30 |
| [21](./21-api-routes.md) | API Route Contracts | Every API endpoint: auth, messages, servers, channels, DMs, users, notifications, media, cron | ~100 |
| [22](./22-visual-regression.md) | Visual Regression | Screenshot baselines for all pages, modals, components across themes/viewports | ~80 |
| [23](./23-webhooks-and-integrations.md) | Webhooks & Integrations | Webhook CRUD/execution, OAuth, Sentry tunnel, workspace, docs, tasks, admin | ~30 |
| [24](./24-realtime-and-subscriptions.md) | Realtime & Subscriptions | Messages, reactions, DMs, typing, presence, threads, unread, subscription lifecycle | ~35 |
| [25](./25-edge-cases-and-error-handling.md) | Edge Cases & Error Handling | Network failures, concurrency, race conditions, boundaries, error boundaries, empty states | ~45 |

**Total estimated tests: ~1,300+**

---

## Quick Start

```bash
# Install Playwright
cd apps/web
npm install -D @playwright/test @axe-core/playwright
npx playwright install

# Run all tests
npx playwright test

# Run specific suite
npx playwright test e2e/auth/

# Run smoke tests only
npx playwright test --grep @smoke

# Run with UI mode
npx playwright test --ui

# Run with headed browser
npx playwright test --headed

# Update visual snapshots
npx playwright test --update-snapshots
```

## VS Code Integration

1. Install the `ms-playwright.playwright` extension
2. Open any `.spec.ts` file
3. Click the green play button next to any test to run/debug
4. Use the Testing panel (beaker icon) for full suite management

See [00-setup-and-conventions.md](./00-setup-and-conventions.md) for full configuration details.

---

## Test Priority Order

When implementing tests, follow this priority:

### P0 — Critical Path (implement first)

1. `01-authentication.md` — Login, register, email verification
2. `03-channels-and-messaging.md` — Send/receive messages, reactions
3. `04-direct-messages.md` — DM send/receive
4. `16-security.md` — XSS, CSRF, input validation
5. `21-api-routes.md` — Cross-cutting API checks (401/403/400)

### P1 — Core Features

1. `02-server-management.md` — Server CRUD, invites
2. `07-roles-and-permissions.md` — Permission enforcement
3. `06-moderation.md` — Ban, kick, audit log
4. `09-notifications.md` — Unread indicators, push
5. `17-threads.md` — Thread messaging

### P2 — Feature Completeness

1. `05-voice-and-webrtc.md` — Voice channels
2. `11-app-store-and-bots.md` — Bot functionality
3. `08-search-and-discovery.md` — Search, discover
4. `12-media-and-attachments.md` — Upload, playback
5. `24-realtime-and-subscriptions.md` — Realtime sync

### P3 — Polish & Quality

1. `10-user-settings.md` — All settings pages
2. `13-profile-and-badges.md` — Profile features
3. `14-onboarding.md` — First-time experience
4. `15-pwa-and-mobile.md` — Mobile, offline
5. `18-events-and-calendar.md` — Events
6. `19-accessibility.md` — a11y compliance
7. `20-performance.md` — Performance budgets
8. `22-visual-regression.md` — Visual baselines
9. `23-webhooks-and-integrations.md` — Integrations
10. `25-edge-cases-and-error-handling.md` — Edge cases
