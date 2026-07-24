/**
 * Shared localStorage helpers — used by hooks/components that persist simple
 * flags to localStorage (e.g. hooks/use-notification-sound.ts).
 */

/** Write a boolean to localStorage (best-effort, no throw). */
export function persistBooleanStorage(key: string, value: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Best effort only — storage may be full or disabled
  }
}
