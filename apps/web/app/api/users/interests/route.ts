import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { createDb, users } from "@vortex/db"
import { getBetterAuthUser } from "@/lib/auth/better-auth"

const db = createDb()

const MAX_TAGS = 15
const MAX_TAG_LEN = 30
// slug-safe: lowercase letters, digits, hyphens; must start/end with alphanumeric
const TAG_REGEX = /^[a-z0-9][a-z0-9\-]*[a-z0-9]?$/

function validateTags(tags: unknown): { valid: true; tags: string[] } | { valid: false; error: string } {
  if (!Array.isArray(tags)) return { valid: false, error: "interests must be an array" }
  if (tags.length > MAX_TAGS) return { valid: false, error: `Maximum ${MAX_TAGS} interests allowed` }
  for (const tag of tags) {
    if (typeof tag !== "string") return { valid: false, error: "Each interest must be a string" }
    const t = tag.trim()
    if (t.length === 0) return { valid: false, error: "Interest tags cannot be empty" }
    if (t.length > MAX_TAG_LEN) return { valid: false, error: `Tag "${t}" exceeds ${MAX_TAG_LEN} characters` }
    if (!TAG_REGEX.test(t)) {
      return { valid: false, error: `Tag "${t}" is invalid — use lowercase letters, numbers, and hyphens only` }
    }
  }
  return { valid: true, tags: tags.map((t: string) => t.trim()) }
}

/** PUT /api/users/interests — replace the authenticated user's full interests list */
export async function PUT(request: Request) {
  try {
    const { data: { user }, error: authError } = await getBetterAuthUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || !("interests" in body)) {
      return NextResponse.json({ error: "Request body must include an `interests` array" }, { status: 400 })
    }

    const result = validateTags(body.interests)
    if (!result.valid) return NextResponse.json({ error: result.error }, { status: 422 })

    let row: { id: string; interests: string[] } | undefined
    try {
      const rows = await db
        .update(users)
        .set({ interests: result.tags })
        .where(eq(users.id, user.id))
        .returning({ id: users.id, interests: users.interests })
      row = rows[0]
    } catch {
      return NextResponse.json({ error: "Failed to save interests" }, { status: 500 })
    }

    if (!row) return NextResponse.json({ error: "Failed to save interests" }, { status: 500 })

    return NextResponse.json(row)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
