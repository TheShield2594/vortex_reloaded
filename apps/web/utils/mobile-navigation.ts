/**
 * Mobile back-button history management.
 *
 * On mobile PWAs, the hardware back button pops from the browser history stack.
 * Without explicit management, pressing back exits the PWA entirely.
 *
 * This utility pushes a two-entry history stack (base → channel) so that
 * back navigates to the channel list instead of leaving the app.
 * Inspired by Fluxer's MobileNavigation pattern.
 */

/**
 * Navigate to a channel while building a proper back-stack so the
 * Android hardware back button returns to the channel list (baseUrl)
 * instead of exiting the PWA.
 *
 * Uses the History API directly to build a two-entry stack in one
 * synchronous operation, avoiding the unreliable setTimeout sequencing
 * between router.replace and router.push.
 */
export function navigateToWithMobileHistory(
  router: { push: (url: string) => void },
  targetUrl: string,
  baseUrl: string,
) {
  // Only apply the two-entry stack trick on mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768

  if (!isMobile) {
    router.push(targetUrl)
    return
  }

  // Preserve existing history state (e.g. vortexGuard from setupMobileBackGuard)
  // so the guard listener continues to recognise its own entries.
  const prevState = window.history.state

  // Build the back-stack synchronously via the History API:
  // 1. Replace the current entry with the base (channel list)
  // 2. Push the target on top
  // This means: back → channel list, back again → previous page or home.
  window.history.replaceState(prevState, "", baseUrl)
  window.history.pushState(prevState, "", targetUrl)

  // Signal the App Router to sync with the new URL without triggering
  // setupMobileBackGuard — use a private event instead of PopStateEvent.
  window.dispatchEvent(new Event("vortex:route-sync"))
}

/**
 * Set up a popstate listener that prevents exiting the PWA when the
 * history stack is exhausted. Navigates to fallbackUrl instead of
 * letting the PWA close.
 */
export function setupMobileBackGuard(fallbackUrl: string) {
  if (typeof window === "undefined") return () => {}

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  if (!isStandalone) return () => {}

  // Push an initial guard entry so there's always something to go back to.
  // Merge with existing history state to preserve any framework state (e.g. Next.js).
  const existingState = window.history.state
  window.history.pushState({ ...existingState, vortexGuard: true }, "", window.location.href)

  function onPopState(e: PopStateEvent) {
    if (e.state?.vortexGuard) return
    // Instead of trapping the user by re-pushing the current URL,
    // navigate to the fallback (e.g. channel list) so the back button
    // feels natural.
    window.location.href = fallbackUrl
  }

  window.addEventListener("popstate", onPopState)
  return () => window.removeEventListener("popstate", onPopState)
}
