"use client"

import { useCallback, useEffect, useMemo } from "react"

const IS_DEV = process.env.NODE_ENV !== "production"

type ShortcutScope = "global" | "nonInput"

type ShortcutActionId =
  | "quickSwitcher"
  | "search"
  | "searchSlash"
  | "searchInChannel"
  | "markRead"
  | "markAllServerRead"
  | "jumpChannelPrev"
  | "jumpChannelNext"
  | "jumpUnreadPrev"
  | "jumpUnreadNext"
  | "moveChannelUp"
  | "moveChannelDown"
  | "toggleMemberList"
  | "toggleThreadPanel"
  | "toggleWorkspacePanel"
  | "openShortcutHelp"

export interface ShortcutHandlers {
  onQuickSwitcher?: () => void
  onSearch?: () => void
  onSearchInChannel?: () => void
  onMarkRead?: () => void
  onMarkAllServerRead?: () => void
  onJumpChannelPrev?: () => void
  onJumpChannelNext?: () => void
  onJumpUnreadPrev?: () => void
  onJumpUnreadNext?: () => void
  onMoveChannelUp?: () => void
  onMoveChannelDown?: () => void
  onToggleMemberList?: () => void
  onToggleThreadPanel?: () => void
  onToggleWorkspacePanel?: () => void
  onOpenShortcutHelp?: () => void
  onAnalytics?: (event: { action: ShortcutActionId; combo: string }) => void
}

interface ShortcutDefinition {
  id: ShortcutActionId
  label: string
  group: "Navigation" | "Search" | "Panels" | "System"
  scope: ShortcutScope
  combos: string[]
  enabled: boolean
  run?: () => void
}

function isInputLike(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
}

function isWithinDialogLike(element: HTMLElement | null): boolean {
  if (!element) return false
  return Boolean(
    element.closest('[role="dialog"]') ||
    element.closest("dialog") ||
    element.closest('[aria-modal="true"]') ||
    element.hasAttribute("aria-modal")
  )
}

function isFocusInDialog(target: EventTarget | null): boolean {
  const targetElement = target as HTMLElement | null
  const activeElement = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  return isWithinDialogLike(targetElement) || isWithinDialogLike(activeElement)
}

function normalizeCombo(event: KeyboardEvent) {
  const key = event.key.toLowerCase()
  const parts = [
    event.metaKey ? "meta" : null,
    event.ctrlKey ? "ctrl" : null,
    event.altKey ? "alt" : null,
    event.shiftKey ? "shift" : null,
    key,
  ].filter(Boolean)
  return parts.join("+")
}

function humanizeCombo(combo: string) {
  return combo
    .split("+")
    .map((part) => {
      if (part === "meta") return "⌘"
      if (part === "ctrl") return "Ctrl"
      if (part === "alt") return "Alt"
      if (part === "shift") return "Shift"
      if (part === "arrowup") return "↑"
      if (part === "arrowdown") return "↓"
      if (part === "/") return "/"
      if (part === "?") return "?"
      return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
    })
    .join(" + ")
}

export function getShortcutRegistry(handlers: ShortcutHandlers): ShortcutDefinition[] {
  return [
    { id: "quickSwitcher", label: "Open Quick Switcher", group: "Search", scope: "global", combos: ["meta+k", "ctrl+k"], enabled: !!handlers.onQuickSwitcher, run: handlers.onQuickSwitcher },
    { id: "search", label: "Search", group: "Search", scope: "global", combos: ["meta+f", "ctrl+f"], enabled: !!handlers.onSearch, run: handlers.onSearch },
    { id: "searchSlash", label: "Search", group: "Search", scope: "nonInput", combos: ["/"], enabled: !!handlers.onSearch, run: handlers.onSearch },
    { id: "searchInChannel", label: "Search in Current Channel", group: "Search", scope: "global", combos: ["meta+shift+f", "ctrl+shift+f"], enabled: !!handlers.onSearchInChannel, run: handlers.onSearchInChannel },
    { id: "markRead", label: "Mark Current Channel Read", group: "Navigation", scope: "nonInput", combos: ["escape"], enabled: !!handlers.onMarkRead, run: handlers.onMarkRead },
    { id: "markAllServerRead", label: "Mark All Channels Read", group: "Navigation", scope: "nonInput", combos: ["alt+shift+m", "meta+shift+m", "ctrl+shift+m"], enabled: !!handlers.onMarkAllServerRead, run: handlers.onMarkAllServerRead },
    { id: "jumpChannelPrev", label: "Jump to Previous Channel", group: "Navigation", scope: "nonInput", combos: ["alt+arrowup"], enabled: !!handlers.onJumpChannelPrev, run: handlers.onJumpChannelPrev },
    { id: "jumpChannelNext", label: "Jump to Next Channel", group: "Navigation", scope: "nonInput", combos: ["alt+arrowdown"], enabled: !!handlers.onJumpChannelNext, run: handlers.onJumpChannelNext },
    { id: "jumpUnreadPrev", label: "Jump to Previous Unread", group: "Navigation", scope: "nonInput", combos: ["alt+shift+arrowup"], enabled: !!handlers.onJumpUnreadPrev, run: handlers.onJumpUnreadPrev },
    { id: "jumpUnreadNext", label: "Jump to Next Unread", group: "Navigation", scope: "nonInput", combos: ["alt+shift+arrowdown"], enabled: !!handlers.onJumpUnreadNext, run: handlers.onJumpUnreadNext },
    { id: "moveChannelUp", label: "Move Channel Up", group: "Navigation", scope: "nonInput", combos: ["ctrl+alt+arrowup", "meta+alt+arrowup"], enabled: !!handlers.onMoveChannelUp, run: handlers.onMoveChannelUp },
    { id: "moveChannelDown", label: "Move Channel Down", group: "Navigation", scope: "nonInput", combos: ["ctrl+alt+arrowdown", "meta+alt+arrowdown"], enabled: !!handlers.onMoveChannelDown, run: handlers.onMoveChannelDown },
    { id: "toggleMemberList", label: "Toggle Member List", group: "Panels", scope: "nonInput", combos: ["meta+u", "ctrl+u"], enabled: !!handlers.onToggleMemberList, run: handlers.onToggleMemberList },
    { id: "toggleThreadPanel", label: "Toggle Thread Panel", group: "Panels", scope: "nonInput", combos: ["meta+.", "ctrl+."], enabled: !!handlers.onToggleThreadPanel, run: handlers.onToggleThreadPanel },
    { id: "toggleWorkspacePanel", label: "Toggle Workspace Panel", group: "Panels", scope: "nonInput", combos: ["meta+,", "ctrl+,"], enabled: !!handlers.onToggleWorkspacePanel, run: handlers.onToggleWorkspacePanel },
    { id: "openShortcutHelp", label: "Open Keyboard Shortcut Help", group: "System", scope: "nonInput", combos: ["meta+/", "ctrl+/", "shift+?", "?"], enabled: !!handlers.onOpenShortcutHelp, run: handlers.onOpenShortcutHelp },
  ]
}

export function getDiscoverableShortcutMappings(handlers: ShortcutHandlers) {
  return getShortcutRegistry(handlers).filter((shortcut) => shortcut.enabled).map((shortcut) => ({
    ...shortcut,
    combos: shortcut.combos.map(humanizeCombo),
  }))
}

/**
 * Singleton guard — only one keydown listener is active at a time.
 * During route transitions the outgoing component's cleanup may run after the
 * new component mounts, which would otherwise leave two listeners on window.
 * We store a monotonically increasing ID; each effect checks whether it is
 * still the active instance before processing events.
 */
let activeShortcutInstanceId = 0

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const registry = useMemo(() => getShortcutRegistry(handlers), [handlers])

  useEffect(() => {
    const instanceId = ++activeShortcutInstanceId

    const lookup = new Map<string, ShortcutDefinition>()
    for (const shortcut of registry) {
      if (!shortcut.enabled || !shortcut.run) continue
      for (const combo of shortcut.combos) {
        if (lookup.has(combo) && IS_DEV) {
          console.warn("[shortcuts] conflict", { combo, previous: lookup.get(combo)?.id, ignored: shortcut.id })
          continue
        }
        lookup.set(combo, shortcut)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      // Stale instance — a newer mount has taken over
      if (instanceId !== activeShortcutInstanceId) return

      const combo = normalizeCombo(event)
      const shortcut = lookup.get(combo)
      if (!shortcut || !shortcut.run) return
      if (shortcut.scope === "nonInput" && (isInputLike(event.target) || isFocusInDialog(event.target))) return

      event.preventDefault()
      if (IS_DEV) {
        console.debug("[shortcuts] fired", { action: shortcut.id, combo })
      }
      handlers.onAnalytics?.({ action: shortcut.id, combo })
      shortcut.run()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [registry, handlers])
}

export function useChannelNavShortcuts(channelIds: string[], activeId: string | null, onNavigate: (id: string) => void) {
  const onJumpChannelPrev = useCallback(() => {
    if (channelIds.length === 0) return
    const currentIndex = activeId ? channelIds.indexOf(activeId) : -1
    const nextIndex = currentIndex <= 0 ? channelIds.length - 1 : currentIndex - 1
    onNavigate(channelIds[nextIndex])
  }, [activeId, channelIds, onNavigate])

  const onJumpChannelNext = useCallback(() => {
    if (channelIds.length === 0) return
    const currentIndex = activeId ? channelIds.indexOf(activeId) : -1
    const nextIndex = currentIndex >= channelIds.length - 1 ? 0 : currentIndex + 1
    onNavigate(channelIds[nextIndex])
  }, [activeId, channelIds, onNavigate])

  const handlers = useMemo(() => ({ onJumpChannelPrev, onJumpChannelNext }), [onJumpChannelPrev, onJumpChannelNext])

  useKeyboardShortcuts(handlers)
}
