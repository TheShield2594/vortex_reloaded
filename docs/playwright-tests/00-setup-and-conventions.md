# Playwright Test Suite — Setup & Conventions

> Master reference for project-wide Playwright configuration, helpers, fixtures, and naming conventions.

---

## Directory Structure

```
apps/web/
├── e2e/
│   ├── fixtures/          # Shared test fixtures (auth states, seed data)
│   │   ├── auth.setup.ts          # Global auth setup — creates persistent login states
│   │   ├── seed-server.ts         # Creates a test server with channels, roles, members
│   │   ├── seed-dm.ts             # Creates DM conversations with messages
│   │   └── test-users.ts          # Test user credentials and metadata
│   ├── helpers/           # Reusable page-object models and utilities
│   │   ├── auth.helper.ts         # Login/logout/register helpers
│   │   ├── server.helper.ts       # Server CRUD, channel navigation
│   │   ├── message.helper.ts      # Send message, wait for message, reactions
│   │   ├── dm.helper.ts           # DM navigation, send DM
│   │   ├── modal.helper.ts        # Open/close/interact with modals
│   │   ├── voice.helper.ts        # Join/leave voice, mock WebRTC
│   │   ├── moderation.helper.ts   # Ban, kick, mute, audit log checks
│   │   ├── api.helper.ts          # Direct API calls for setup/teardown
│   │   └── wait.helper.ts         # Custom wait conditions (realtime, toast, etc.)
│   ├── auth/              # 01-authentication.md tests
│   ├── servers/           # 02-server-management.md tests
│   ├── channels/          # 03-channels-and-messaging.md tests
│   ├── dm/                # 04-direct-messages.md tests
│   ├── voice/             # 05-voice-and-webrtc.md tests
│   ├── moderation/        # 06-moderation.md tests
│   ├── roles/             # 07-roles-and-permissions.md tests
│   ├── search/            # 08-search-and-discovery.md tests
│   ├── notifications/     # 09-notifications.md tests
│   ├── settings/          # 10-user-settings.md tests
│   ├── apps/              # 11-app-store-and-bots.md tests
│   ├── media/             # 12-media-and-attachments.md tests
│   ├── profile/           # 13-profile-and-badges.md tests
│   ├── onboarding/        # 14-onboarding.md tests
│   ├── pwa/               # 15-pwa-and-mobile.md tests
│   ├── security/          # 16-security.md tests
│   ├── threads/           # 17-threads.md tests
│   ├── events/            # 18-events-and-calendar.md tests
│   ├── accessibility/     # 19-accessibility.md tests
│   ├── performance/       # 20-performance.md tests
│   ├── api/               # 21-api-routes.md tests
│   └── visual/            # 22-visual-regression.md tests
├── playwright.config.ts
└── .env.test
```

---

## Playwright Config Reference

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    // Auth setup — runs first, saves storage state
    { name: 'setup', testMatch: /auth\.setup\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /global\.teardown\.ts/ },

    // Desktop browsers
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },

    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

---

## Test Data Management & Isolation

Since `fullyParallel: true` is set, tests run concurrently across workers. Each test must be self-contained.

### Database Isolation Strategy
- **Unique test data** — Each test creates servers/channels/users with UUID-suffixed names (e.g., `test-server-${crypto.randomUUID().slice(0,8)}`) to avoid collisions between parallel workers
- **Per-worker test databases** — Each Playwright worker can target a separate Supabase schema/project if needed for heavy isolation
- **Transaction rollback** — Where Supabase supports it, wrap test setup/teardown in transactions

### Cleanup Patterns

```ts
test.afterEach(async ({ request }) => {
  // Clean up test data created during the test
  if (testServerId) {
    await request.delete(`/api/servers/${testServerId}`);
  }
  // Clean up storage state artifacts if needed
  // fs.rmSync('.auth/temp-user.json', { force: true });
});

// Per-worker setup for isolated test databases
test.beforeAll(async ({ browser }) => {
  const workerIndex = test.info().parallelIndex;
  // Configure worker-specific Supabase schema or test database
});
```

### Mocking External Services

- **Supabase Realtime** — Use isolated test channels with unique names; unsubscribe in `afterEach`
- **WebRTC** — Mock `navigator.mediaDevices.getUserMedia` and `RTCPeerConnection` via `page.addInitScript()`:
  ```ts
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  });
  ```
- **External APIs** (Klipy, Giphy, Sentry) — Intercept with `page.route()`:
  ```ts
  await page.route('**/api.klipy.com/**', route =>
    route.fulfill({ json: { results: [] } })
  );
  ```

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Test file | `kebab-case.spec.ts` | `login-email-password.spec.ts` |
| Describe block | Feature area + scenario group | `describe('Login — email/password')` |
| Test name | `should` + expected behavior | `should show error for invalid password` |
| Page object | `PascalCase` class | `class ServerSettingsPage` |
| Fixture | `camelCase` function | `seedTestServer()` |
| Data-testid | `kebab-case` | `data-testid="message-input"` |

---

## Required `data-testid` Attributes

Tests rely on `data-testid` selectors. These MUST be added to components:

### Global Layout
- `server-sidebar`, `channel-sidebar`, `member-list`
- `mobile-bottom-tab-bar`, `mobile-nav`
- `user-panel`, `connection-banner`

### Auth
- `login-form`, `login-email`, `login-password`, `login-submit`
- `register-form`, `register-email`, `register-password`, `register-username`, `register-submit`
- `verify-email-page`, `resend-verification`
- `mfa-input`, `mfa-submit`

### Chat
- `message-input`, `message-send-button`
- `message-item-{id}`, `message-content`, `message-author`
- `emoji-picker-trigger`, `emoji-picker`, `gif-picker`, `sticker-picker`
- `typing-indicator`, `reply-preview`
- `pinned-messages-trigger`, `pinned-messages-panel`

### Servers
- `create-server-button`, `create-server-modal`
- `server-icon-{id}`, `server-name`
- `channel-item-{id}`, `category-header-{id}`

### DMs
- `dm-list`, `dm-item-{id}`, `dm-channel-area`
- `dm-message-input`, `dm-message-item-{id}`

### Voice
- `voice-channel-{id}`, `voice-join-button`, `voice-leave-button`
- `voice-mute-toggle`, `voice-deafen-toggle`, `voice-screen-share`
- `voice-grid-layout`, `voice-participant-{id}`

### Settings
- `settings-sidebar`, `settings-content`
- `profile-settings`, `appearance-settings`, `security-settings`
- `notification-settings`, `voice-settings`, `accessibility-settings`

---

## Environment Variables (`.env.test`)

```env
TEST_BASE_URL=http://localhost:3000
TEST_SUPABASE_URL=http://localhost:54321
TEST_SUPABASE_ANON_KEY=...
TEST_USER_EMAIL=test@vortexchat.test
TEST_USER_PASSWORD=TestPassword123!
TEST_ADMIN_EMAIL=admin@vortexchat.test
TEST_ADMIN_PASSWORD=AdminPassword123!
TEST_MOD_EMAIL=mod@vortexchat.test
TEST_MOD_PASSWORD=ModPassword123!
```

---

## VS Code Integration

### Recommended Extensions
- `ms-playwright.playwright` — Playwright Test for VS Code (run/debug tests inline)
- `ms-vscode.test-adapter-converter` — Test Explorer integration

### `.vscode/settings.json` additions
```json
{
  "playwright.reuseBrowser": true,
  "playwright.showTrace": true,
  "testing.defaultGutterClickAction": "debug"
}
```

### Launch Configs (`.vscode/launch.json`)
```json
{
  "configurations": [
    {
      "name": "Playwright: Current File",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/playwright",
      "args": ["test", "${file}", "--headed"],
      "cwd": "${workspaceFolder}/apps/web"
    },
    {
      "name": "Playwright: Debug Current Test",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/playwright",
      "args": ["test", "${file}", "--headed", "--debug"],
      "cwd": "${workspaceFolder}/apps/web"
    }
  ]
}
```

---

## Test Tagging Strategy

Use `@tag` annotations for selective test runs:

```ts
test('should send a message @smoke @chat', async ({ page }) => { ... });
test('should upload 50MB file @slow @media', async ({ page }) => { ... });
test('should render emoji picker @visual @chat', async ({ page }) => { ... });
```

Run by tag: `npx playwright test --grep @smoke`

| Tag | Purpose |
|-----|---------|
| `@smoke` | Critical path — run on every PR |
| `@slow` | Tests > 30s — run nightly |
| `@visual` | Screenshot comparison tests |
| `@a11y` | Accessibility checks |
| `@mobile` | Mobile-specific behavior |
| `@api` | API route tests |
| `@realtime` | WebSocket/Supabase realtime tests |
| `@voice` | WebRTC/voice tests (need mocks) |
