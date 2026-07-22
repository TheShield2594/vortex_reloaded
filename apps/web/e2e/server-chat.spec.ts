import { test, expect } from "@playwright/test"
import { hasSupabase } from "./utils"

/**
 * E2E tests for core server and chat functionality.
 *
 * These tests require a running dev server and Supabase.
 * They are designed to run sequentially (fullyParallel: false)
 * so they can share server/channel state.
 */

test.describe("Server and Chat", () => {
  test.describe.configure({ mode: "serial" })

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/servers")
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test("app shell loads with server sidebar", async ({ page }) => {
    // This test requires auth — skip if no test account is seeded
    test.skip(!hasSupabase || !process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD, "Requires a real Supabase backend plus E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars")

    await page.goto("/login")
    await page.locator("input[type='email']").fill(process.env.E2E_TEST_EMAIL!)
    await page.locator("input[type='password']").fill(process.env.E2E_TEST_PASSWORD!)
    await page.getByRole("button", { name: /log in|sign in/i }).click()

    await page.waitForURL(/\/servers/, { timeout: 15_000 })

    // Server sidebar should be visible (desktop)
    await expect(page.locator("[data-testid='server-sidebar'], .server-sidebar, nav").first()).toBeVisible()
  })

  test("message input is visible in a channel", async ({ page }) => {
    test.skip(!hasSupabase || !process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD, "Requires a real Supabase backend plus E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars")

    await page.goto("/login")
    await page.locator("input[type='email']").fill(process.env.E2E_TEST_EMAIL!)
    await page.locator("input[type='password']").fill(process.env.E2E_TEST_PASSWORD!)
    await page.getByRole("button", { name: /log in|sign in/i }).click()

    await page.waitForURL(/\/servers/, { timeout: 15_000 })

    // Navigate to the first available channel link
    const channelLink = page.locator("a[href*='/channels/']").first()
    if (await channelLink.isVisible()) {
      await channelLink.click()
      await page.waitForURL(/\/channels\//, { timeout: 10_000 })

      // Message input should be present
      const messageInput = page.locator("textarea, [contenteditable='true'], input[placeholder*='message' i]").first()
      await expect(messageInput).toBeVisible({ timeout: 10_000 })
    }
  })

  test("search modal opens with keyboard shortcut", async ({ page }) => {
    test.skip(!hasSupabase || !process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD, "Requires a real Supabase backend plus E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars")

    await page.goto("/login")
    await page.locator("input[type='email']").fill(process.env.E2E_TEST_EMAIL!)
    await page.locator("input[type='password']").fill(process.env.E2E_TEST_PASSWORD!)
    await page.getByRole("button", { name: /log in|sign in/i }).click()

    await page.waitForURL(/\/servers/, { timeout: 15_000 })

    // Ctrl+K or Cmd+K should open search/quickswitcher
    await page.keyboard.press("Control+k")
    const modal = page.locator("[role='dialog'], .modal, [data-testid='search-modal'], [data-testid='quickswitcher']").first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
  })
})
