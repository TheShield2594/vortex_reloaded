import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"
import type { CuratedSection } from "@vortex/shared"

export async function GET(): Promise<NextResponse> {
  try {
    // Use service-role client because app_curated_sections/entries have
    // public SELECT RLS policies but the anon role lacks direct SELECT
    // on app_catalog (same pattern as /api/apps/discover).
    const supabase = await createServiceRoleClient()

    const { data: sections, error: sectionsError } = await supabase
      .from("app_curated_sections")
      .select("id, slug, title, description")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })

    if (sectionsError) {
      return NextResponse.json({ error: "Failed to load curated sections" }, { status: 500 })
    }
    if (!sections || sections.length === 0) {
      return NextResponse.json([])
    }

    const sectionIds = sections.map((s) => s.id)

    const { data: entries, error: entriesError } = await supabase
      .from("app_curated_entries")
      .select("section_id, sort_order, app_id")
      .in("section_id", sectionIds)
      .order("sort_order", { ascending: true })

    if (entriesError) {
      return NextResponse.json({ error: "Failed to load curated entries" }, { status: 500 })
    }
    if (!entries || entries.length === 0) {
      return NextResponse.json([])
    }

    const appIds = [...new Set(entries.map((e) => e.app_id))]

    const { data: apps, error: appsError } = await supabase
      .from("app_catalog")
      .select("id, slug, name, description, category, trust_badge, average_rating, review_count, icon_url")
      .in("id", appIds)
      .eq("is_published", true)

    if (appsError) {
      return NextResponse.json({ error: "Failed to load curated apps" }, { status: 500 })
    }
    if (!apps) {
      return NextResponse.json([])
    }

    const appMap = new Map(apps.map((a) => [a.id, a]))

    const result: CuratedSection[] = sections
      .map((section) => {
        const sectionEntries = entries
          .filter((e) => e.section_id === section.id)
          .sort((a, b) => a.sort_order - b.sort_order)

        const sectionApps = sectionEntries
          .map((e) => appMap.get(e.app_id))
          .filter((a): a is NonNullable<typeof a> => a != null)

        return {
          id: section.id,
          slug: section.slug,
          title: section.title,
          description: section.description,
          apps: sectionApps,
        }
      })
      .filter((s) => s.apps.length > 0)

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
