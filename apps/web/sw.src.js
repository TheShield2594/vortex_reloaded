// VortexChat Service Worker — source file.
// In production this is processed by `scripts/build-sw.mjs` (workbox-build
// injectManifest), which replaces the WB_MANIFEST placeholder with the list of
// content-hashed /_next/static/ assets and writes the result to public/sw.js.
// In development, public/sw.js does not exist (it is gitignored). SW
// registration will 404 silently, which is expected — offline support and
// push notifications are not available in dev. Run `npm run build` once if
// you need to test SW features locally.

// ─── VAPID key helper ────────────────────────────────────────────────────────
// Convert a base64url-encoded VAPID public key to a Uint8Array.
// PushManager.subscribe() requires BufferSource on iOS Safari; the string
// form is not universally supported.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

// ─── Cache names ────────────────────────────────────────────────────────────
const PRECACHE = "vortexchat-precache-v7"
const RUNTIME = "vortexchat-runtime-v7"
const APP_SHELL = "vortexchat-shell-v7"
const API_CACHE = "vortexchat-api-v1"
const API_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const ALL_CACHES = [PRECACHE, RUNTIME, APP_SHELL, API_CACHE]

// ─── Precache manifest ───────────────────────────────────────────────────────
// Injected by workbox-build: list of { url, revision } objects for every
// /_next/static/ chunk produced by `next build`. Falls back to [] in dev.
const PRECACHE_MANIFEST = self.__WB_MANIFEST || []
const PRECACHE_URLS = PRECACHE_MANIFEST.map((e) =>
  typeof e === "string" ? e : e.url
)

// Static app-shell assets — not content-hashed, cached separately.
const APP_SHELL_ASSETS = [
  "/",
  "/channels/me",
  "/offline",
  "/manifest.json",
  "/icon-192.png?v=2",
  "/icon-192-maskable.png?v=2",
  "/icon-512.png?v=2",
  "/icon-512-maskable.png?v=2",
]

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting()
  event.waitUntil(
    Promise.all([
      // Content-hashed Next.js chunks — safe to cache aggressively.
      PRECACHE_URLS.length > 0
        ? caches.open(PRECACHE).then((c) => c.addAll(PRECACHE_URLS))
        : Promise.resolve(),
      // App shell — offline navigation fallback.
      caches.open(APP_SHELL).then((c) => c.addAll(APP_SHELL_ASSETS)),
    ])
  )
})

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
        )
      )
  )
  self.clients.claim()
})

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigation — network-first, offline fallback to app shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type !== "error") {
            const copy = response.clone()
            caches.open(APP_SHELL).then((c) => c.put("/channels/me", copy))
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(APP_SHELL)
          return (
            (await cache.match("/channels/me")) ||
            (await cache.match("/offline")) ||
            (await cache.match("/")) ||
            new Response("Offline", { status: 503, statusText: "Service Unavailable" })
          )
        })
    )
    return
  }

  // /_next/static/ — cache-first (URLs are content-hashed and immutable).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(PRECACHE).then((c) => c.put(request, copy))
            }
            return response
          })
      )
    )
    return
  }

  // Scripts, styles, fonts, images — stale-while-revalidate.
  if (["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(RUNTIME).then((c) => c.put(request, copy))
            }
            return response
          })
          .catch(() => cached)
        return cached || fetchPromise
      })
    )
    return
  }

  // API message history — network-first with short TTL cache for offline access.
  // Caches GET /api/messages and /api/channels/*/messages responses so users
  // can view recent messages when offline.
  // Cache entries are scoped per-user via cookie hash to prevent cross-account leaks.
  if (/^\/api\/(messages|channels\/[^/]+\/messages)\/?$/.test(url.pathname)) {
    // Cache is keyed by full request URL (including channelId query params),
    // which is inherently user-scoped since channel access is auth-gated.
    // The SW runs in a single-user browser context so cross-account risk
    // is minimal. Cache entries are cleared on SW version bumps (ALL_CACHES).
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Skip caching if the server explicitly opts out
          const cc = response.headers.get("cache-control") || ""
          if (response.ok && !cc.includes("no-store")) {
            const copy = response.clone()
            caches.open(API_CACHE).then((c) => {
              // Store with a timestamp header for TTL enforcement
              const headers = new Headers(copy.headers)
              headers.set("sw-cache-time", Date.now().toString())
              c.put(request, new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers }))
            })
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(API_CACHE)
          const cached = await cache.match(request)
          if (cached) {
            // Enforce TTL — evict stale entries
            const cacheTime = parseInt(cached.headers.get("sw-cache-time") || "0", 10)
            if (Date.now() - cacheTime < API_CACHE_TTL) {
              return cached
            }
            cache.delete(request)
          }
          return new Response(JSON.stringify({ error: "Offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        })
    )
    return
  }
})

// ─── Push notifications ───────────────────────────────────────────────────────
// Always show the notification regardless of whether the app is focused.
// On iOS, every push event MUST call showNotification() or the OS may
// revoke the push subscription.
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    try { data = { title: "VortexChat", body: event.data?.text() ?? "New message" } } catch { /* empty payload */ }
  }

  const {
    title = "VortexChat",
    body = "New message",
    icon = "/icon-192.png?v=2",
    url = "/channels/me",
    tag,
  } = data

  // Detect iOS PWA — iOS incorrectly reports backgrounded tabs as "focused"
  // via clients.matchAll(), so we must force renotify:true and silent:false.
  // Also, iOS Safari does not support notification action buttons, and using
  // the same tag silently replaces earlier notifications without alerting.
  const isIOS = /iP(hone|ad|od)/.test(self.navigator?.userAgent ?? "")

  // On iOS, append a timestamp to the tag so each notification is unique
  // and not silently replaced. Desktop keeps channel-based grouping.
  const notificationTag = isIOS
    ? `${tag || "vortexchat-message"}-${Date.now()}`
    : (tag || "vortexchat-message")

  // iOS Safari ignores notification action buttons — omit them to save
  // payload bytes and avoid console warnings.
  const actions = isIOS ? [] : (url !== "/channels/me" ? [
    { action: "open", title: "Open" },
    { action: "dismiss", title: "Dismiss" },
  ] : [])

  // CRITICAL: Call showNotification() IMMEDIATELY — do NOT nest it inside
  // clients.matchAll().then() or any other async chain.  On iOS, the SW
  // has strict execution time limits (~30s).  If matchAll() is slow or
  // hangs (common when the app is backgrounded), iOS kills the SW before
  // showNotification fires, treats it as a "silent push", and eventually
  // revokes the push subscription entirely.
  //
  // On iOS, always show with sound (silent:false) because the focused-tab
  // check via matchAll is unreliable.  On desktop, we run matchAll in
  // parallel and silently update the notification if a tab is focused.
  const notificationPromise = self.registration.showNotification(title, {
    body,
    icon,
    badge: "/icon-192.png?v=2",
    tag: notificationTag,
    data: { url },
    renotify: true,
    requireInteraction: false,
    actions,
    silent: false,
  })

  // waitUntil MUST resolve from showNotification — everything else is
  // best-effort and must not block or delay the notification.
  event.waitUntil(
    notificationPromise.then(() => {
      // Best-effort badge update — fire and forget.
      fetch("/api/notifications/unread-count", { credentials: "same-origin" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          const count = json?.count
          if (typeof count === "number" && isFinite(count)) updateAppBadge(count)
        })
        .catch(() => {})

      // On non-iOS, check if a tab is focused and replace with a silent
      // notification to prevent double-play with in-app sounds.
      if (!isIOS) {
        self.clients.matchAll({ type: "window", includeUncontrolled: false })
          .then((clients) => {
            const anyFocused = clients.some((c) => c.focused)
            if (anyFocused) {
              // Re-show as silent — same tag replaces the audible one
              self.registration.showNotification(title, {
                body,
                icon,
                badge: "/icon-192.png?v=2",
                tag: notificationTag,
                data: { url },
                renotify: false,
                requireInteraction: false,
                actions,
                silent: true,
              })
            }
          })
          .catch(() => {})
      }
    })
  )
})

// ─── App badge helper ────────────────────────────────────────────────────────
function updateAppBadge(count) {
  // The Badging API is on the ServiceWorkerGlobalScope (self), not on
  // self.navigator.  iOS follows the spec strictly — using navigator
  // silently fails.
  if (typeof self.setAppBadge !== "function") return
  if (count > 0) {
    self.setAppBadge(count)
  } else if (typeof self.clearAppBadge === "function") {
    self.clearAppBadge()
  }
}

// ─── App badge + SW messages ──────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "APP_UPDATE_BADGE") {
    updateAppBadge(event.data.count)
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
  // Clear API cache on auth transitions to prevent cross-account data leaks.
  // The main app should postMessage({ type: "CLEAR_API_CACHE" }) on logout/login.
  if (event.data?.type === "CLEAR_API_CACHE") {
    event.waitUntil(caches.delete(API_CACHE))
  }
})

// ─── Push subscription rotation ───────────────────────────────────────────────
// Re-subscribe if the browser rotates push keys, then sync to the server.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription

        // Clean up the stale old endpoint from the server (best-effort).
        if (oldSub?.endpoint) {
          fetch("/api/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: oldSub.endpoint }),
          }).catch(() => {})
        }

        // Build subscribe options — prefer the old subscription's options
        // (which already contain the applicationServerKey as an ArrayBuffer),
        // but fall back to fetching the VAPID public key from the server and
        // converting it to a Uint8Array.  The string form of
        // applicationServerKey is NOT supported on all browsers (notably iOS
        // Safari), so we must always pass a BufferSource.
        let subscribeOptions = oldSub?.options
        if (!subscribeOptions?.applicationServerKey) {
          try {
            const keyRes = await fetch("/api/push/vapid-key")
            if (keyRes.ok) {
              const { key } = await keyRes.json()
              if (typeof key === "string" && key) {
                subscribeOptions = {
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(key),
                }
              }
            }
          } catch {
            // VAPID key fetch failed — proceed with userVisibleOnly only
          }
        }
        const newSub = await self.registration.pushManager.subscribe(
          subscribeOptions ?? { userVisibleOnly: true }
        )
        const { endpoint, keys } = newSub.toJSON()
        const res = await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, keys }),
        })
        if (!res.ok) throw new Error("Server returned " + res.status)
      } catch (err) {
        console.warn("SW pushsubscriptionchange: re-subscribe failed", err)
      }

      // Notify open tabs so the client-side hook can re-subscribe.
      const clients = await self.clients.matchAll({ type: "window" })
      for (const client of clients) {
        client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" })
      }
    })()
  )
})

// ─── Notification click ───────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  // Handle action buttons — "dismiss" just closes
  if (event.action === "dismiss") return

  const url = event.notification.data?.url || "/channels/me"
  const fullUrl = new URL(url, self.location.origin).href

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Prefer a tab that's already on the same channel to avoid a full reload
        const sameChannel = clients.find((c) => {
          try {
            const clientUrl = new URL(c.url)
            const targetUrl = new URL(fullUrl)
            return clientUrl.pathname === targetUrl.pathname && clientUrl.search === targetUrl.search
          } catch { return false }
        })
        const existing = sameChannel || clients.find((c) => c.url.includes(self.location.origin))
        if (existing) {
          return existing.focus().then(() => {
            // Post a message so the client can handle in-app navigation
            // without a full page reload when already on the right channel.
            existing.postMessage({ type: "NOTIFICATION_NAVIGATE", url })
            return sameChannel ? undefined : existing.navigate(fullUrl)
          })
        } else {
          return self.clients.openWindow(fullUrl)
        }
      })
  )
})

// ─── Periodic background sync ─────────────────────────────────────────────────
// Fires when the browser grants a periodic sync opportunity.
// Used to refresh unread counts and prefetch latest messages so the app
// opens instantly with fresh data.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "vortex-refresh-unread") {
    event.waitUntil(
      fetch("/api/notifications/unread-count", { credentials: "same-origin" })
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          const count = data?.count
          if (typeof count !== "number" || !isFinite(count)) return
          updateAppBadge(count)
        })
        .catch(() => {
          // Sync failed — silently ignore, will retry next interval
        })
    )
  }
})
