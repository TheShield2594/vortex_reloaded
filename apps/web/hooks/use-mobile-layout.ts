"use client"

import { useSyncExternalStore } from "react"

const QUERY = "(min-width: 768px)"

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return !window.matchMedia(QUERY).matches
}

function getServerSnapshot() {
  return false
}

/**
 * Mobile detection using matchMedia at 768px (Tailwind's md breakpoint).
 * Uses useSyncExternalStore to avoid tearing and ensure consistent reads.
 */
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
