import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb, ntfySubscriptions } from "@vortex/db"
import { requireAuth, parseJsonBody, apiError } from "@/lib/utils/api-helpers"
import { generateNtfyTopic, isNtfyConfigured } from "@/lib/ntfy"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/user/ntfy")
const db = createDb()

const TOPIC_GENERATION_RETRIES = 5

// GET /api/user/ntfy — read the current user's self-hosted ntfy subscription state
export async function GET() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const rows = await db
      .select({ topic: ntfySubscriptions.topic, enabled: ntfySubscriptions.enabled })
      .from(ntfySubscriptions)
      .where(eq(ntfySubscriptions.userId, user.id))
      .limit(1)
    const row = rows[0]

    return NextResponse.json({
      serverConfigured: isNtfyConfigured(),
      publicUrl: process.env.NEXT_PUBLIC_NTFY_URL || null,
      topic: row?.topic ?? null,
      enabled: row?.enabled ?? false,
    })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "GET", error: err instanceof Error ? err.message : String(err) }, "GET error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST /api/user/ntfy — create (if missing) the user's private topic and enable delivery
export async function POST() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    if (!isNtfyConfigured()) {
      return apiError("Self-hosted ntfy push is not configured on this server", 400)
    }

    // Atomic upsert keyed on userId (the primary key) — two concurrent POSTs
    // (double-click, multiple tabs) both hit this same statement instead of
    // racing a separate "does a row exist" check against a later insert, so
    // neither can see a stale "no row" read and fail on a PK conflict.
    // A thrown error here can only be a genuine `topic` uniqueness collision
    // (a different constraint), which is what's retried below.
    let succeeded = false
    for (let attempt = 0; attempt < TOPIC_GENERATION_RETRIES && !succeeded; attempt++) {
      try {
        await db
          .insert(ntfySubscriptions)
          .values({ userId: user.id, topic: generateNtfyTopic(), enabled: true })
          .onConflictDoUpdate({
            target: ntfySubscriptions.userId,
            set: { enabled: true },
          })
        succeeded = true
      } catch (err) {
        // Unique constraint collision on `topic` — astronomically unlikely
        // (32 base36 chars) but retry rather than fail outright.
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined
        if (code !== "SQLITE_CONSTRAINT_UNIQUE" || attempt === TOPIC_GENERATION_RETRIES - 1) {
          log.error({ route: "/api/user/ntfy", action: "POST", userId: user.id, error: err instanceof Error ? err.message : String(err) }, "failed to create ntfy subscription")
          return NextResponse.json({ error: "Failed to enable ntfy push" }, { status: 500 })
        }
      }
    }

    if (!succeeded) return NextResponse.json({ error: "Failed to enable ntfy push" }, { status: 500 })

    // Re-read rather than trusting the just-generated candidate — on an
    // upsert-into-existing-row, the persisted topic is whatever was already
    // there, not the (discarded) candidate this call generated.
    const rows = await db
      .select({ topic: ntfySubscriptions.topic })
      .from(ntfySubscriptions)
      .where(eq(ntfySubscriptions.userId, user.id))
      .limit(1)
    const topic = rows[0]?.topic
    if (!topic) return NextResponse.json({ error: "Failed to enable ntfy push" }, { status: 500 })

    return NextResponse.json({ topic, enabled: true }, { status: 201 })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "POST", error: err instanceof Error ? err.message : String(err) }, "POST error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/user/ntfy — toggle delivery on/off without changing the topic
export async function PUT(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const { data: body, error: parseError } = await parseJsonBody<{ enabled?: unknown }>(req)
    if (parseError) return parseError

    if (typeof body.enabled !== "boolean") {
      return apiError("enabled must be a boolean", 400)
    }

    const updated = await db
      .update(ntfySubscriptions)
      .set({ enabled: body.enabled })
      .where(eq(ntfySubscriptions.userId, user.id))
      .returning({ topic: ntfySubscriptions.topic })

    if (!updated.length) {
      return apiError("No ntfy topic to update — POST first to create one", 404)
    }

    return NextResponse.json({ topic: updated[0]?.topic, enabled: body.enabled })
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "PUT", error: err instanceof Error ? err.message : String(err) }, "PUT error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/user/ntfy — rotate the topic (e.g. if it was ever shared/leaked)
export async function DELETE() {
  try {
    const { user, error: authError } = await requireAuth()
    if (authError) return authError

    const existing = await db
      .select({ topic: ntfySubscriptions.topic, enabled: ntfySubscriptions.enabled })
      .from(ntfySubscriptions)
      .where(eq(ntfySubscriptions.userId, user.id))
      .limit(1)

    if (!existing[0]) {
      return apiError("No ntfy subscription to rotate", 404)
    }

    // Conditional update on the topic just read, so a concurrent rotation
    // (two tabs both clicking "rotate") can't silently overwrite the other's
    // result — the loser's UPDATE matches zero rows (WHERE topic no longer
    // matches) and re-reads the winner's topic instead of returning a value
    // that's no longer what's persisted.
    let previousTopic = existing[0].topic
    let result: { topic: string; enabled: boolean } | null = null

    for (let attempt = 0; attempt < TOPIC_GENERATION_RETRIES && !result; attempt++) {
      try {
        const updated = await db
          .update(ntfySubscriptions)
          .set({ topic: generateNtfyTopic() })
          .where(and(eq(ntfySubscriptions.userId, user.id), eq(ntfySubscriptions.topic, previousTopic)))
          .returning({ topic: ntfySubscriptions.topic, enabled: ntfySubscriptions.enabled })

        if (updated[0]) {
          result = updated[0]
          break
        }

        const current = await db
          .select({ topic: ntfySubscriptions.topic, enabled: ntfySubscriptions.enabled })
          .from(ntfySubscriptions)
          .where(eq(ntfySubscriptions.userId, user.id))
          .limit(1)
        if (!current[0]) return apiError("No ntfy subscription to rotate", 404)
        result = current[0]
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined
        if (code !== "SQLITE_CONSTRAINT_UNIQUE" || attempt === TOPIC_GENERATION_RETRIES - 1) {
          log.error({ route: "/api/user/ntfy", action: "DELETE", userId: user.id, error: err instanceof Error ? err.message : String(err) }, "failed to rotate ntfy topic")
          return NextResponse.json({ error: "Failed to rotate ntfy topic" }, { status: 500 })
        }
      }
    }

    if (!result) return NextResponse.json({ error: "Failed to rotate ntfy topic" }, { status: 500 })

    return NextResponse.json(result)
  } catch (err) {
    log.error({ route: "/api/user/ntfy", action: "DELETE", error: err instanceof Error ? err.message : String(err) }, "DELETE error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
