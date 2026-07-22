"use client"

import { useEffect, useRef, type ReactNode, type ReactElement } from "react"

interface ScrollRevealProps {
  children: ReactNode
  className?: string
  delay?: number
}

export function ScrollReveal({ children, className = "", delay = 0 }: ScrollRevealProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Respect reduced motion
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (prefersReduced) {
      el.style.opacity = "1"
      el.style.transform = "none"
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timeoutId = setTimeout(() => {
            el.style.transition = "opacity 0.6s ease-out, transform 0.6s ease-out"
            el.style.opacity = "1"
            el.style.transform = "translateY(0)"
          }, delay)
          observer.unobserve(el)
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    )

    observer.observe(el)
    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      observer.disconnect()
    }
  }, [delay])

  return (
    <div
      ref={ref}
      className={className}
      style={{ opacity: 0, transform: "translateY(24px)" }}
    >
      {children}
    </div>
  )
}
