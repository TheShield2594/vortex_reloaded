import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { rateLimiter } from "@/lib/rate-limit"
import { getClientIp } from "@vortex/shared"
import type { DiscoverServersResponse } from "@vortex/shared"

const PAGE_SIZE = 24

const VALID_SORTS = new Set(["members", "newest"] as const)
type SortOption = "members" | "newest"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Escape characters that are special in PostgREST filter strings. */
function escapePostgrestValue(raw: string): string {
  return raw.replace(/[\\%_,()]/g, (ch) => `\\${ch}`)
}

// GET /api/servers/discover?q=search&sort=members|newest&cursor=uuid
// Lists public servers with search, sorting, and cursor pagination
export async function GET(req: NextRequest) {
  // Rate-limit by IP before any DB work
  const ip = getClientIp(req.headers) ?? "unknown"
  try {
    const rl = await rateLimiter.check(`discover:${ip}`, { limit: 30, windowMs: 60_000 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }
  } catch {
    // Fail open — don't block server discovery if rate limiter is down
  }

  const supabase = await createServerSupabaseClient()

  // Allow anonymous access but establish auth context for Supabase RLS
  await supabase.auth.getUser()

  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")?.trim()
  const rawSort = searchParams.get("sort")
  const sort: SortOption = rawSort && VALID_SORTS.has(rawSort as SortOption) ? (rawSort as SortOption) : "members"
  const cursor = searchParams.get("cursor")?.trim() || null

  // Determine sort column and direction
  const orderCol = sort === "newest" ? "created_at" : "member_count"
  const ascending = false

  let query = supabase
    .from("servers")
    .select("id, name, description, icon_url, member_count, invite_code, created_at")
    .eq("is_public", true)
    .order(orderCol, { ascending })
    .order("id", { ascending })
    .limit(PAGE_SIZE + 1) // fetch one extra to detect next page

  // Search across name and description (sanitize for PostgREST)
  if (q) {
    const escaped = escapePostgrestValue(q)
    query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`)
  }

  // Cursor-based pagination: fetch the cursor row to get its sort value
  if (cursor && UUID_RE.test(cursor)) {
    const { data: cursorRow } = await supabase
      .from("servers")
      .select("member_count, created_at")
      .eq("id", cursor)
      .single()

    if (cursorRow) {
      if (sort === "newest") {
        query = query.lt("created_at", cursorRow.created_at)
      } else {
        // For member_count ties, use id as tiebreaker
        query = query.or(
          `member_count.lt.${cursorRow.member_count},and(member_count.eq.${cursorRow.member_count},id.lt.${cursor})`
        )
      }
    }
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: "Failed to fetch servers" }, { status: 500 })

  const items = data ?? []
  const hasMore = items.length > PAGE_SIZE
  const page = hasMore ? items.slice(0, PAGE_SIZE) : items
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const response: DiscoverServersResponse = { servers: page, nextCursor }
  return NextResponse.json(response)
}
