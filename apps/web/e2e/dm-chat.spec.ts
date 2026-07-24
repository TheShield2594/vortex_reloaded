import { test, expect } from "@playwright/test"
import { hasSeededAccount } from "./utils"

/**
 * E2E tests for core direct-message and chat functionality.
 *
 * The app is DM-first (the Discord-style server/channel model was retired in
 * the cutover); the authenticated home is `/channels/me`. These tests need a
 * running server and a migrated SQLite database. Authenticated flows are
 * skipped unless a seeded account is supplied via E2E_TEST_EMAIL /
 * E2E_TEST_PASSWORD. They run serially so they can share session state.
 */

test.describe("Direct Messages and Chat", () => {
  test.describe.configure({ mode: "serial" })

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/channels/me")
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test("app shell loads with DM sidebar", async ({ page }) => {
    // This test requires auth — skip if no test account is seeded
    test.skip(!hasSeededAccount, "Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD")

    await page.goto("/login")
    await page.locator("input[type='email']").fill(process.env.E2E_TEST_EMAIL!)
    await page.locator("input[type='password']").fill(process.env.E2E_TEST_PASSWORD!)
    await page.getByRole("button", { name: /log in|sign in/i }).click()

    await page.waitForURL(/\/channels\/me/, { timeout: 15_000 })

    // DM sidebar should be visible (desktop)
    await expect(page.locator("[data-testid='dm-sidebar'], .dm-sidebar, nav").first()).toBeVisible()
  })

  test("message input is visible in a DM channel", async ({ page }) => {
    test.skip(!hasSeededAccount, "Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD")

    await page.goto("/login")
    await page.locator("input[type='email']").fill(process.env.E2E_TEST_EMAIL!)
    await page.locator("input[type='password']").fill(process.env.E2E_TEST_PASSWORD!)
    await page.getByRole("button", { name: /log in|sign in/i }).click()

    await page.waitForURL(/\/channels\/me/, { timeout: 15_000 })

    // Navigate to the first available DM conversation link
    const dmLink = page.locator("a[href*='/channels/me/']").first()
    if (await dmLink.isVisible()) {
      await dmLink.click()
      await page.waitForURL(/\/channels\/me\//, { timeout: 10_000 })

      // Message input should be present
      const messageInput = page.locator("textarea, [contenteditable='true'], input[placeholder*='message' i]").first()
      await expect(messageInput).toBeVisible({ timeout: 10_000 })
    }
  })

  test("search modal opens with keyboard shortcut", async ({ page }) => {
    test.skip(!hasSeededAccount, "Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD")

    await page.goto("/login")
    await page.locator("input[type='email']").fill(process.env.E2E_TEST_EMAIL!)
    await page.locator("input[type='password']").fill(process.env.E2E_TEST_PASSWORD!)
    await page.getByRole("button", { name: /log in|sign in/i }).click()

    await page.waitForURL(/\/channels\/me/, { timeout: 15_000 })

    // Ctrl+K or Cmd+K should open search/quickswitcher
    await page.keyboard.press("Control+k")
    const modal = page.locator("[role='dialog'], .modal, [data-testid='search-modal'], [data-testid='quickswitcher']").first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
  })
})
