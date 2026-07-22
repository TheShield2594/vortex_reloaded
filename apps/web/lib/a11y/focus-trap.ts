export const FOCUSABLE_SELECTOR_LIST = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
] as const

export const FOCUSABLE_SELECTOR = FOCUSABLE_SELECTOR_LIST.join(",")

export function getNextFocusIndex(currentIndex: number, total: number, shiftKey: boolean): number {
  if (total <= 0) return -1
  if (currentIndex < 0 || currentIndex >= total) return shiftKey ? total - 1 : 0
  if (shiftKey) return currentIndex === 0 ? total - 1 : currentIndex - 1
  return currentIndex === total - 1 ? 0 : currentIndex + 1
}
