"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"

interface UseViewTransitionReturn {
  navigate: (href: string, options?: { replace?: boolean }) => void
}

/**
 * Wraps Next.js router navigations with the View Transitions API
 * for smooth cross-fade route animations.
 *
 * Falls back to standard navigation when the API is unavailable
 * or the user has `prefers-reduced-motion: reduce` enabled.
 */
export function useViewTransition(): UseViewTransitionReturn {
  const router = useRouter()

  const navigate = useCallback(
    (href: string, options?: { replace?: boolean }): void => {
      const supportsViewTransitions =
        typeof document !== "undefined" &&
        "startViewTransition" in document

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches

      const doNavigate = (): void => {
        if (options?.replace) {
          router.replace(href)
        } else {
          router.push(href)
        }
      }

      if (!supportsViewTransitions || prefersReducedMotion) {
        doNavigate()
        return
      }

      (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
        try {
          doNavigate()
        } catch (err) {
          console.error("[useViewTransition] Navigation failed during transition:", err)
        }
      })
    },
    [router]
  )

  return { navigate }
}
