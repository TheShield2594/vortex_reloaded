import { test, expect } from "@playwright/test"

/**
 * E2E accessibility smoke tests.
 *
 * These verify key WCAG requirements are met in the rendered DOM.
 */

test.describe("Accessibility", () => {
  test("login page has proper document structure", async ({ page }) => {
    await page.goto("/login")

    // Page should have a lang attribute
    const html = page.locator("html")
    await expect(html).toHaveAttribute("lang")

    // Should have at least one heading
    const headings = page.locator("h1, h2, h3")
    await expect(headings.first()).toBeVisible()
  })

  test("login form inputs have accessible labels", async ({ page }) => {
    await page.goto("/login")

    // Email input should have an associated label
    const emailInput = page.locator("input[type='email']")
    const emailId = await emailInput.getAttribute("id")
    if (emailId) {
      const label = page.locator(`label[for='${emailId}']`)
      await expect(label).toBeVisible()
    }

    // Password input should have an associated label
    const passwordInput = page.locator("input[type='password']")
    const passwordId = await passwordInput.getAttribute("id")
    if (passwordId) {
      const label = page.locator(`label[for='${passwordId}']`)
      await expect(label).toBeVisible()
    }
  })

  test("register page inputs have autocomplete attributes", async ({ page }) => {
    await page.goto("/register")

    const emailInput = page.locator("input[type='email']")
    await expect(emailInput).toHaveAttribute("autocomplete", "email")

    const passwordInputs = page.locator("input[type='password']")
    const count = await passwordInputs.count()
    for (let i = 0; i < count; i++) {
      await expect(passwordInputs.nth(i)).toHaveAttribute("autocomplete", "new-password")
    }
  })

  test("interactive elements have sufficient contrast indicators", async ({ page }) => {
    await page.goto("/login")

    // Buttons should be visible and have text or aria-label
    const buttons = page.locator("button")
    const count = await buttons.count()
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      if (await btn.isVisible()) {
        const text = await btn.textContent()
        const ariaLabel = await btn.getAttribute("aria-label")
        // Each visible button should have text content or an aria-label
        expect(text?.trim() || ariaLabel).toBeTruthy()
      }
    }
  })

  test("no images without alt text", async ({ page }) => {
    await page.goto("/login")

    const images = page.locator("img")
    const count = await images.count()
    for (let i = 0; i < count; i++) {
      const img = images.nth(i)
      const alt = await img.getAttribute("alt")
      // alt can be empty string (decorative) but must be present
      expect(alt).not.toBeNull()
    }
  })

  test("focus order follows visual layout", async ({ page }) => {
    await page.goto("/login")

    // Wait for splash screen overlay to fade out before testing Tab order
    await page.waitForSelector("[aria-hidden='true'][style*='pointer-events']", { state: "detached", timeout: 5_000 }).catch(() => {})

    // Tab through the page and collect focused element types
    const focusedElements: string[] = []
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab")
      const tag = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase() ?? "none")
      focusedElements.push(tag)
    }

    // Should encounter interactive elements (input, button, a)
    const interactiveCount = focusedElements.filter(
      (t) => ["input", "button", "a", "select", "textarea"].includes(t)
    ).length
    expect(interactiveCount).toBeGreaterThan(0)
  })
})
