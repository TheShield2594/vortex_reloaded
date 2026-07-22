"use client"

/**
 * Centralized notification manager — handles:
 *
 * 1. **Focused-window suppression**: Don't play sound or show browser
 *    notification if the user is viewing the relevant channel.
 *
 * 2. **Per-channel notification tracking**: Track up to MAX_PER_CHANNEL
 *    browser Notification instances per channel, auto-close them when the
 *    user focuses that channel.
 *
 * 3. **Duplicate suppression**: LRU cache of notified message IDs prevents
 *    duplicate notifications from overlapping realtime subscriptions.
 *
 * Modeled after Fluxer's NotificationStore + notificationTracker.
 */

// ---------------------------------------------------------------------------
// Window focus tracking (lazy-initialized to avoid SSR side effects)
// ---------------------------------------------------------------------------

let windowFocused = false
let focusListenersInitialized = false

function ensureFocusListeners(): void {
  if (focusListenersInitialized || typeof window === "undefined") return
  focusListenersInitialized = true
  windowFocused = document.hasFocus()
  window.addEventListener("focus", () => { windowFocused = true })
  window.addEventListener("blur", () => { windowFocused = false })
}

export function isWindowFocused(): boolean {
  ensureFocusListeners()
  return windowFocused
}

// ---------------------------------------------------------------------------
// Active channel tracking (set by ChatArea / DM view)
// ---------------------------------------------------------------------------

let activeChannelId: string | null = null
let activeDmChannelId: string | null = null

export function setActiveChannel(channelId: string | null): void {
  activeChannelId = channelId
  // When user focuses a channel, close tracked notifications for it
  if (channelId) clearChannelNotifications(channelId)
}

export function setActiveDmChannel(dmChannelId: string | null): void {
  activeDmChannelId = dmChannelId
  if (dmChannelId) clearChannelNotifications(dmChannelId)
}

export function getActiveChannelId(): string | null {
  return activeChannelId
}

export function getActiveDmChannelId(): string | null {
  return activeDmChannelId
}

// ---------------------------------------------------------------------------
// Per-channel notification tracking (browser Notification instances)
// ---------------------------------------------------------------------------

const MAX_PER_CHANNEL = 5

interface TrackedNotification {
  notification: Notification
  channelId: string
}

// channelId → array of tracked notifications
const channelNotifications = new Map<string, TrackedNotification[]>()

function trackNotification(channelId: string, notification: Notification): void {
  let entries = channelNotifications.get(channelId)
  if (!entries) {
    entries = []
    channelNotifications.set(channelId, entries)
  }

  // If over limit, close the oldest
  while (entries.length >= MAX_PER_CHANNEL) {
    const oldest = entries.shift()
    try { oldest?.notification.close() } catch { /* already closed */ }
  }

  entries.push({ notification, channelId })

  // Auto-remove when closed
  notification.addEventListener("close", () => {
    const arr = channelNotifications.get(channelId)
    if (arr) {
      const idx = arr.findIndex((e) => e.notification === notification)
      if (idx >= 0) arr.splice(idx, 1)
      if (arr.length === 0) channelNotifications.delete(channelId)
    }
  })
}

function clearChannelNotifications(channelId: string): void {
  const entries = channelNotifications.get(channelId)
  if (!entries) return
  for (const entry of entries) {
    try { entry.notification.close() } catch { /* already closed */ }
  }
  channelNotifications.delete(channelId)
}

export function clearAllNotifications(): void {
  for (const [, entries] of channelNotifications) {
    for (const entry of entries) {
      try { entry.notification.close() } catch { /* already closed */ }
    }
  }
  channelNotifications.clear()
}

// ---------------------------------------------------------------------------
// Notified message ID dedup (LRU)
// ---------------------------------------------------------------------------

const MAX_NOTIFIED_IDS = 500
const notifiedMessageIds = new Set<string>()
const notifiedOrder: string[] = []

function markNotified(messageId: string): void {
  if (notifiedMessageIds.has(messageId)) return
  notifiedMessageIds.add(messageId)
  notifiedOrder.push(messageId)
  // Evict oldest
  while (notifiedOrder.length > MAX_NOTIFIED_IDS) {
    const oldest = notifiedOrder.shift()
    if (oldest) notifiedMessageIds.delete(oldest)
  }
}

export function wasAlreadyNotified(messageId: string): boolean {
  return notifiedMessageIds.has(messageId)
}

// ---------------------------------------------------------------------------
// Should we show a notification / play sound?
// ---------------------------------------------------------------------------

export interface ShouldNotifyResult {
  shouldPlaySound: boolean
  shouldShowBrowserNotification: boolean
}

/**
 * Decides whether to play a sound and/or show a browser notification
 * based on the current window focus state and active channel.
 *
 * Logic (matches Fluxer):
 * - If window is focused AND user is viewing the relevant channel → neither
 * - If window is focused but on a DIFFERENT channel → sound only (no browser notification)
 * - If window is not focused → both sound and browser notification
 */
export function shouldNotify(opts: {
  channelId?: string | null
  dmChannelId?: string | null
  messageId?: string | null
}): ShouldNotifyResult {
  const { channelId, dmChannelId, messageId } = opts

  // Dedup check
  if (messageId && wasAlreadyNotified(messageId)) {
    return { shouldPlaySound: false, shouldShowBrowserNotification: false }
  }
  if (messageId) markNotified(messageId)

  const focused = isWindowFocused()

  // Check if the user is viewing the relevant channel
  const isViewingChannel =
    (channelId && channelId === activeChannelId) ||
    (dmChannelId && dmChannelId === activeDmChannelId)

  if (focused && isViewingChannel) {
    // User is staring at this channel — no sound, no notification
    return { shouldPlaySound: false, shouldShowBrowserNotification: false }
  }

  if (focused && !isViewingChannel) {
    // User is on the app but in a different channel — sound only
    return { shouldPlaySound: true, shouldShowBrowserNotification: false }
  }

  // Window not focused — full notification
  return { shouldPlaySound: true, shouldShowBrowserNotification: true }
}

// ---------------------------------------------------------------------------
// Show browser notification (with tracking + click handling)
// ---------------------------------------------------------------------------

export function showBrowserNotification(opts: {
  title: string
  body: string
  icon?: string
  url?: string
  channelId?: string
}): Notification | null {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return null
  }

  try {
    const notification = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon || "/icon-192.png",
      tag: opts.channelId ? `vortex-${opts.channelId}` : undefined,
      silent: true, // We handle sound ourselves to prevent double-play
    })

    notification.addEventListener("click", (event) => {
      event.preventDefault()
      window.focus()
      if (opts.url) {
        // Navigate directly — window.location works universally; Next.js
        // will handle client-side routing for same-origin paths.
        window.location.href = opts.url
      }
      notification.close()
    })

    // Track for auto-close when user focuses the channel
    if (opts.channelId) {
      trackNotification(opts.channelId, notification)
    }

    return notification
  } catch {
    return null
  }
}
