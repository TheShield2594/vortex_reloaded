import { useSyncExternalStore } from "react"

const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null

function subscribe(onStoreChange: () => void): () => void {
  query?.addEventListener("change", onStoreChange)
  return () => query?.removeEventListener("change", onStoreChange)
}

function getSnapshot(): boolean {
  return query?.matches ?? false
}

function getServerSnapshot(): boolean {
  return false
}

/** Returns `true` when the user prefers reduced motion. SSR-safe. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
