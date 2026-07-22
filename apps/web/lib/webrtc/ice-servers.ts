/**
 * Fetch ephemeral TURN credentials from the server-side endpoint.
 * Falls back to STUN-only if the endpoint is unavailable or slow.
 */

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

const FETCH_TIMEOUT_MS = 5_000

let cachedServers: RTCIceServer[] | null = null
let cacheRefreshAt = 0
let cacheValidUntil = 0

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  // Return cached credentials if before the refresh threshold
  if (cachedServers && Date.now() < cacheRefreshAt) {
    return cachedServers
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch("/api/turn-credentials", { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn("[ice-servers] TURN credentials unavailable, using STUN only")
      if (cachedServers && Date.now() < cacheValidUntil) return cachedServers
      return STUN_SERVERS
    }

    const data: { iceServers: RTCIceServer[]; ttl: number } = await res.json()
    cachedServers = data.iceServers
    cacheValidUntil = Date.now() + data.ttl * 1000
    // Refresh 5 minutes before TTL expires
    cacheRefreshAt = cacheValidUntil - 300_000
    return cachedServers
  } catch (err) {
    clearTimeout(timer)
    // Return still-valid cached credentials on refresh failure
    if (cachedServers && Date.now() < cacheValidUntil) {
      return cachedServers
    }
    const reason = err instanceof DOMException && err.name === "AbortError" ? "timeout" : err
    console.warn("[ice-servers] Failed to fetch TURN credentials:", reason)
    return STUN_SERVERS
  }
}
