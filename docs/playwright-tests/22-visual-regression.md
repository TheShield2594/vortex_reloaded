# 22 — Visual Regression Tests

> Covers: screenshot comparisons for all major UI surfaces across themes, viewports, and states. Uses Playwright's built-in `toHaveScreenshot()`.

---

## 22.1 Configuration

```ts
// In playwright.config.ts
expect: {
  toHaveScreenshot: {
    maxDiffPixelRatio: 0.01,  // Allow 1% pixel diff
    threshold: 0.2,            // Color diff threshold
    animations: 'disabled',    // Disable animations for stable screenshots
  },
},
```

**Viewport matrix:**
- Desktop: 1920x1080, 1440x900, 1280x720
- Tablet: 768x1024
- Mobile: 375x812 (iPhone), 360x800 (Android)

**Theme matrix:**
- Dark theme, Light theme

---

## 22.2 Auth Pages

### `visual-auth.spec.ts`

| # | Page | States | Expected |
|---|------|--------|----------|
| 1 | Login page | Empty, filled, error, loading | Screenshots match baseline |
| 2 | Register page | Empty, filled, error, loading | Screenshots match |
| 3 | Verify email page | Default, resend sent | Screenshots match |
| 4 | Update password page | Empty, filled | Screenshots match |
| 5 | MFA challenge | Default, error | Screenshots match |

---

## 22.3 Main App Surfaces

### `visual-app-surfaces.spec.ts`

| # | Surface | States | Expected |
|---|---------|--------|----------|
| 1 | Server sidebar | No servers, 1 server, many servers | Baseline match |
| 2 | Channel sidebar | Empty, with channels, with categories | Baseline match |
| 3 | Member list | Empty, with members, with roles | Baseline match |
| 4 | Chat area | Empty channel, with messages, with reactions | Baseline match |
| 5 | Message input | Empty, with text, with reply preview, with attachment | Baseline match |
| 6 | DM list | Empty, with conversations, with unread | Baseline match |
| 7 | DM conversation | Empty, with messages, with reactions | Baseline match |
| 8 | User panel (bottom left) | Online, idle, DND, offline | Baseline match |

---

## 22.4 Modals & Overlays

### `visual-modals.spec.ts`

| # | Modal | States | Expected |
|---|-------|--------|----------|
| 1 | Create server modal | Step 1 (templates), step 2 (details) | Baseline match |
| 2 | Create channel modal | Default, filled | Baseline match |
| 3 | Create thread modal | Default, filled | Baseline match |
| 4 | Invite modal | Default, link generated | Baseline match |
| 5 | Server settings modal | Each tab | Baseline match |
| 6 | Profile settings modal | Default, editing | Baseline match |
| 7 | Search modal | Empty, with results | Baseline match |
| 8 | Quickswitcher | Empty, with results | Baseline match |
| 9 | Keyboard shortcuts modal | Default | Baseline match |
| 10 | Report modal | Empty, filled | Baseline match |
| 11 | Emoji picker | Default, search, custom tab | Baseline match |
| 12 | GIF picker | Trending, search results | Baseline match |
| 13 | Sticker picker | Trending, search results | Baseline match |
| 14 | Image lightbox | Open with image | Baseline match |
| 15 | Context menus | Message context, channel context | Baseline match |

---

## 22.5 Settings Pages

### `visual-settings.spec.ts`

| # | Page | Expected |
|---|------|----------|
| 1 | Settings index | Baseline match |
| 2 | Profile settings | Baseline match |
| 3 | Appearance settings (dark) | Baseline match |
| 4 | Appearance settings (light) | Baseline match |
| 5 | Security settings | Baseline match |
| 6 | Notification settings | Baseline match |
| 7 | Voice settings | Baseline match |
| 8 | Accessibility settings | Baseline match |
| 9 | Keybind settings | Baseline match |

---

## 22.6 Special Surfaces

### `visual-special.spec.ts`

| # | Surface | Expected |
|---|---------|----------|
| 1 | Onboarding flow (each step) | Baseline match |
| 2 | Discover page (servers) | Baseline match |
| 3 | Discover page (apps) | Baseline match |
| 4 | Events calendar | Baseline match |
| 5 | Moderation timeline | Baseline match |
| 6 | Audit log viewer | Baseline match |
| 7 | Voice channel (grid layout) | Baseline match |
| 8 | Compact voice bar | Baseline match |
| 9 | Profile panel | Baseline match |
| 10 | User popover | Baseline match |
| 11 | Connection banner (offline) | Baseline match |
| 12 | Push permission prompt | Baseline match |
| 13 | SW update toast | Baseline match |
| 14 | Splash screen | Baseline match |
| 15 | Skeleton loading states | Baseline match |
| 16 | Offline page | Baseline match |
| 17 | Terms page | Baseline match |
| 18 | Privacy page | Baseline match |
| 19 | Appeals page | Baseline match |
| 20 | Forum channel view | Baseline match |
| 21 | Announcement channel view | Baseline match |
| 22 | Media channel view | Baseline match |

---

## 22.7 Responsive Breakpoints

### `visual-responsive.spec.ts`

| # | Surface | Viewports | Expected |
|---|---------|-----------|----------|
| 1 | Channel page | Desktop, Tablet, Mobile | Layout adapts correctly |
| 2 | DM page | Desktop, Tablet, Mobile | Layout adapts |
| 3 | Settings | Desktop, Tablet, Mobile | Sidebar collapses |
| 4 | Server settings | Desktop, Tablet, Mobile | Responsive layout |
| 5 | Discover page | Desktop, Tablet, Mobile | Grid adapts |
| 6 | Profile panel | Desktop, Tablet, Mobile | Panel adapts |

---

## 22.8 Component-Level Snapshots

### `visual-components.spec.ts`

| # | Component | States | Expected |
|---|-----------|--------|----------|
| 1 | Message item | Text, with attachments, with reactions, system message | Baseline match |
| 2 | Notification bell | No unread, with count | Baseline match |
| 3 | Event card | Upcoming, live, ended | Baseline match |
| 4 | Badge display | Each badge type, rarity glow | Baseline match |
| 5 | Typing indicator | 1 user, 2 users, 3+ users | Baseline match |
| 6 | Thread indicator | On message | Baseline match |
| 7 | Date separator | Today, Yesterday, specific date | Baseline match |
| 8 | Link embed | With image, without image | Baseline match |
| 9 | Role badge | Each color | Baseline match |
| 10 | Connection banner | Each state | Baseline match |
