"use client"

import { useApplyAppearance } from "@/hooks/use-apply-appearance"

/** Thin client wrapper that applies appearance data-attributes to <html> on the settings pages. */
export function SettingsAppearanceProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  useApplyAppearance()
  return <>{children}</>
}
