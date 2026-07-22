import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright configuration for VortexChat E2E tests.
 *
 * Requires a running Next.js dev server and a local Supabase instance.
 * Set NEXT_PUBLIC_SUPABASE_URL to your local Supabase URL (default: http://localhost:54321).
 *
 * Start local Supabase: supabase start
 * Start Next.js:        npm run dev --workspace=apps/web
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Allow 2 minutes per test — the full journey (register → login → server →
  // message → realtime → reload) involves many network round-trips in CI.
  timeout: 120_000,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Do not start dev server automatically — CI handles that separately.
})
