import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth/better-auth"
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachment-validation"

// Next.js 16's proxy.ts (the middleware.ts successor) always runs on the
// Node.js runtime unconditionally — unlike old Edge-only middleware.ts,
// there's no separate runtime to opt into, and no `runtime` config key to
// set (Next rejects it: "Route segment config is not allowed in Proxy
// file"). That's what makes it safe for `auth.api.getSession()` below to
// open Better Auth's SQLite database (better-sqlite3, a native Node addon)
// directly from here.

/**
 * Generate a per-request nonce and Content-Security-Policy header.
 * The nonce replaces 'unsafe-inline' / 'unsafe-eval' in script-src,
 * and 'strict-dynamic' allows scripts loaded by nonced scripts to run.
 */
function buildCsp(): { nonce: string; header: string } {
  const isDev = process.env.NODE_ENV === "development"
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  const nonce = Buffer.from(array).toString("base64")

  // Build domain allowlists from env vars so deployments with different
  // LiveKit / Sentry hosts work without code changes.
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? ""
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ""
  const signalUrl = process.env.NEXT_PUBLIC_SIGNAL_URL ?? ""

  // Extract hostnames for CSP directives
  const livekitHost = safeHost(livekitUrl)      // e.g. "my-app.livekit.cloud"
  const sentryHost = safeHost(sentryDsn)         // e.g. "oXXXXXX.ingest.sentry.io"
  const signalHost = safeHost(signalUrl)         // e.g. "vortex-signal.up.railway.app"

  // img-src: allow any HTTPS image (link previews can reference arbitrary hosts)
  const imgSrc = [
    "'self' blob: data: https:",
  ].join(" ")

  // connect-src: LiveKit, Klipy, Giphy, Sentry
  const connectSrc = [
    "'self'",
    livekitHost ? `wss://${livekitHost}` : "",
    "https://api.klipy.co https://api.klipy.com https://api.giphy.com https://cdn.jsdelivr.net",
    sentryHost ? `https://${sentryHost}` : "",
    signalHost ? `https://${signalHost} wss://${signalHost}` : "",
    "ws: wss:", // TODO: tighten once signal server is deployed
    isDev ? "http://localhost:*" : "",
  ].filter(Boolean).join(" ")

  const header = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src ${imgSrc}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrc}`,
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'none'",
  ].join("; ")

  return { nonce, header }
}

/** Extract hostname from a URL or DSN, returning empty string on failure. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

// Routes that use their own auth (bearer tokens, URL tokens) — skip session
// handling entirely so external callers are never redirected or delayed.
const PASSTHROUGH_ROUTES = [
  "/api/cron",
  "/api/health",
]

// Routes that are public but still benefit from session refresh (login page, etc.)
const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/api/auth",
  "/verify-email",
  // Reached via a password-reset email link with a `?token=` query param,
  // not an active session — Better Auth's resetPassword() flow is
  // token-based, unlike Supabase's old "recovery session" pattern.
  "/update-password",
  "/terms",
  "/privacy",
]

// HTTP methods that mutate state — require origin validation on API routes
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// Request body size limits (bytes). File-upload routes get a higher ceiling;
// everything else caps at 1 MB which is generous for JSON payloads.
const MAX_BODY_BYTES = 1 * 1024 * 1024         // 1 MB — JSON routes
// 1 MB of multipart overhead above the largest thing an upload route
// accepts (DM attachments, MAX_ATTACHMENT_BYTES) — DM attachments used to
// upload straight from the browser to Supabase Storage, bypassing this
// proxy entirely; now that they route through our own server (issue #10),
// this cap applies to them too.
const MAX_UPLOAD_BYTES = MAX_ATTACHMENT_BYTES + 1 * 1024 * 1024
const UPLOAD_ROUTE_PREFIXES = ["/api/users/avatar", "/api/share"]  // routes that accept formData
const UPLOAD_ROUTE_SUFFIXES = ["/attachments"]  // dynamic route: /api/dm/channels/[channelId]/attachments

/**
 * CSRF protection: verify that mutation requests to /api/* originate from our
 * own domain. Checks the Origin header first, then falls back to Referer.
 * Returns true if the request is safe, false if it should be blocked.
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin")
  const expectedOrigin = request.nextUrl.origin

  if (origin) {
    return origin === expectedOrigin
  }

  // Some older browsers omit Origin on same-origin POST — fall back to Referer
  const referer = request.headers.get("referer")
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin
    } catch {
      return false
    }
  }

  // No Origin or Referer — block the request (defense-in-depth)
  return false
}

/**
 * Apply CSP header and x-nonce request header to a response.
 * The x-nonce header lets server components read the nonce via headers().
 */
function applyCsp(
  response: NextResponse,
  nonce: string,
  cspHeader: string,
): NextResponse {
  response.headers.set("Content-Security-Policy", cspHeader)
  response.headers.set("x-nonce", nonce)
  return response
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const { nonce, header: cspHeader } = buildCsp()

  // Forward the nonce and CSP to server components via request headers.
  // Next.js reads Content-Security-Policy from request headers during SSR
  // to auto-nonce its framework scripts.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", cspHeader)

  const isPassthrough = PASSTHROUGH_ROUTES.some((route) => pathname.startsWith(route))

  // CSRF: block cross-origin mutations to API routes (skip machine-auth
  // endpoints that authenticate via bearer/URL token, not cookies)
  if (pathname.startsWith("/api/") && MUTATION_METHODS.has(request.method) && !isPassthrough) {
    if (!isSameOrigin(request)) {
      return applyCsp(
        NextResponse.json(
          { error: "Cross-origin request blocked" },
          { status: 403 },
        ),
        nonce,
        cspHeader,
      )
    }
  }

  // Request body size guard — reject oversized payloads before they hit route
  // handlers (including passthrough routes like /api/webhooks).
  // Missing Content-Length is treated as 0 (valid for body-less DELETE/PATCH);
  // present but non-numeric headers are rejected.
  if (pathname.startsWith("/api/") && MUTATION_METHODS.has(request.method)) {
    const raw = request.headers.get("content-length")
    const contentLength = raw === null ? 0 : /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN
    const isUploadRoute = UPLOAD_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))
      || UPLOAD_ROUTE_SUFFIXES.some((suffix) => pathname.endsWith(suffix))
    const limit = isUploadRoute ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > limit) {
      return applyCsp(
        NextResponse.json(
          { error: "Request body too large" },
          { status: 413 },
        ),
        nonce,
        cspHeader,
      )
    }
  }

  // Machine-to-machine endpoints — pass through with zero Supabase overhead
  // (these authenticate via bearer token / URL token, not cookies)
  if (isPassthrough) {
    return applyCsp(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
      cspHeader,
    )
  }

  const passthroughResponse = NextResponse.next({ request: { headers: requestHeaders } })

  // Allow public routes and marketing homepage — session isn't required, but
  // still resolved so e.g. an already-logged-in user hitting /login could be
  // redirected client-side; unlike Supabase's short-lived JWT, Better Auth's
  // opaque session token doesn't need proactive middleware-side refreshing
  // (7-day expiry, refreshed lazily wherever getSession() is actually called).
  if (pathname === "/" || PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return applyCsp(passthroughResponse, nonce, cspHeader)
  }

  let sessionResult: Awaited<ReturnType<typeof auth.api.getSession>> = null
  try {
    sessionResult = await auth.api.getSession({ headers: request.headers })
  } catch {
    // If the DB is unreachable or misconfigured, fail closed to login.
    // API clients expect JSON, not an HTML redirect.
    if (pathname.startsWith("/api/")) {
      return applyCsp(
        NextResponse.json({ error: "unauthorized" }, { status: 403 }),
        nonce,
        cspHeader,
      )
    }
    const loginUrl = new URL("/login", request.url)
    const dest = request.nextUrl.searchParams.get("redirect") || request.nextUrl.pathname
    loginUrl.searchParams.set("redirect", dest)
    return applyCsp(NextResponse.redirect(loginUrl), nonce, cspHeader)
  }

  if (!sessionResult?.user) {
    if (pathname.startsWith("/api/")) {
      return applyCsp(
        NextResponse.json({ error: "unauthorized" }, { status: 403 }),
        nonce,
        cspHeader,
      )
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return applyCsp(NextResponse.redirect(loginUrl), nonce, cspHeader)
  }

  // Block unverified users from accessing the app
  if (!sessionResult.user.emailVerified) {
    // API clients expect JSON, not a redirect
    if (pathname.startsWith("/api/")) {
      return applyCsp(
        NextResponse.json({ error: "email_unverified" }, { status: 403 }),
        nonce,
        cspHeader,
      )
    }
    const verifyUrl = new URL("/verify-email", request.url)
    return applyCsp(NextResponse.redirect(verifyUrl), nonce, cspHeader)
  }

  return applyCsp(passthroughResponse, nonce, cspHeader)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|webmanifest|txt|xml)$).*)",
  ],
}
