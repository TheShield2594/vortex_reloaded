/**
 * GET /api/badges — list all badge definitions (public catalog)
 */
import { NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { badgeDefinitions, createDb } from "@vortex/db"
import { toSnakeCase } from "@/lib/utils/case"
import type { BadgeDefinitionRow } from "@/types/database"
import { createLogger } from "@/lib/logger"

const log = createLogger("api/badges")
const db = createDb()

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(badgeDefinitions)
      .orderBy(asc(badgeDefinitions.sortOrder))

    const badges = toSnakeCase<BadgeDefinitionRow[]>(rows)

    return NextResponse.json(badges)
  } catch (err) {
    log.error({ err }, "Unexpected error in GET /api/badges")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
