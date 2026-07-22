import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/server"

function sanitizeIlikeQuery(value: string) {
  return value
    .replace(/[,%]/g, "")
    .replace(/[().]/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Allow unauthenticated browsing — public marketplace endpoint.
// Uses service-role client because the app_catalog_public view has
// security_invoker=true which requires the caller to have SELECT on
// the underlying app_catalog table. The anon role does not, so
// unauthenticated browse would return empty results.
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServiceRoleClient()
    const query = req.nextUrl.searchParams.get("q")?.trim()
    const category = req.nextUrl.searchParams.get("category")?.trim()

    const baseBuilder = () => {
      let builder = supabase
        .from("app_catalog")
        .select("id, slug, name, description, category, trust_badge, average_rating, review_count, permissions, icon_url")
        .eq("is_published", true)

      if (category && category !== "all") {
        builder = builder.eq("category", category)
      }

      return builder
    }

    if (query) {
      const safeQuery = sanitizeIlikeQuery(query)
      if (safeQuery) {
        const term = `%${safeQuery}%`
        const [{ data: byName, error: nameError }, { data: byDescription, error: descriptionError }] = await Promise.all([
          baseBuilder().ilike("name", term).order("review_count", { ascending: false }).limit(100),
          baseBuilder().ilike("description", term).order("review_count", { ascending: false }).limit(100),
        ])

        if (nameError || descriptionError) {
          return NextResponse.json({ error: "Failed to search apps" }, { status: 500 })
        }

        const merged = [...(byName ?? []), ...(byDescription ?? [])]
        const unique = Array.from(new Map(merged.map((entry) => [entry.id, entry])).values())
          .sort((a, b) => (b.review_count ?? 0) - (a.review_count ?? 0))

        return NextResponse.json(unique)
      }
    }

    const { data, error } = await baseBuilder().order("review_count", { ascending: false })
    if (error) return NextResponse.json({ error: "Failed to fetch apps" }, { status: 500 })

    return NextResponse.json(data ?? [])

  } catch (err) {
    console.error("[apps/discover GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
