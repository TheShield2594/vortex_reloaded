import { NextRequest, NextResponse } from "next/server"

/**
 * Sentry tunnel endpoint — proxies Sentry envelopes through the first-party
 * domain so ad blockers don't intercept them.
 *
 * @see https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */

// Derive allowed host and project ID from the same DSN the client SDK uses,
// so there is no risk of the server-side allowlist drifting out of sync.
function parseDsnEnv(): { host: string; projectId: string } | null {
  const raw = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!raw) return null
  try {
    const url = new URL(raw)
    return { host: url.hostname, projectId: url.pathname.replace(/\//g, "") }
  } catch {
    return null
  }
}

const UPSTREAM_TIMEOUT_MS = 5_000

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const allowed = parseDsnEnv()
    if (!allowed) {
      return NextResponse.json({ error: "Sentry DSN not configured" }, { status: 503 })
    }

    // Read as raw bytes to preserve binary replay/session data intact.
    // Only the first line (the JSON header) needs to be decoded as text.
    const rawBody = await request.arrayBuffer()
    const bytes = new Uint8Array(rawBody)

    if (bytes.length === 0) {
      return NextResponse.json({ error: "Empty envelope" }, { status: 400 })
    }

    // Find the first newline to extract the JSON header line
    const newlineIdx = bytes.indexOf(0x0a) // '\n'
    const headerBytes = newlineIdx === -1 ? bytes : bytes.subarray(0, newlineIdx)
    const header = new TextDecoder().decode(headerBytes)

    let dsn: URL
    try {
      const parsed: unknown = JSON.parse(header)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid envelope header" }, { status: 400 })
      }
      const dsnValue = (parsed as Record<string, unknown>).dsn
      if (dsnValue === undefined || dsnValue === null) {
        // Some envelope types (sessions, replays, client reports) omit the
        // dsn field from the header. Fall back to the configured DSN so we
        // can still forward them.
        dsn = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN!)
      } else if (typeof dsnValue === "string" && dsnValue.length > 0) {
        dsn = new URL(dsnValue)
      } else {
        return NextResponse.json({ error: "Invalid DSN in envelope header" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: "Invalid envelope header" }, { status: 400 })
    }

    // Validate that the envelope is destined for our Sentry project
    if (dsn.hostname !== allowed.host) {
      return NextResponse.json({ error: "Invalid Sentry host" }, { status: 403 })
    }

    const projectId = dsn.pathname.replace(/\//g, "")
    if (projectId !== allowed.projectId) {
      return NextResponse.json({ error: "Invalid Sentry project" }, { status: 403 })
    }

    const upstreamUrl = `https://${allowed.host}/api/${allowed.projectId}/envelope/`

    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      body: rawBody,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    return new NextResponse(upstreamRes.body, { status: upstreamRes.status })
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 })
    }
    console.error("Sentry tunnel error:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "Tunnel error" }, { status: 500 })
  }
}
