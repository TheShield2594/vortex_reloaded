import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"

const OAUTH_PROVIDERS = new Set(["github", "reddit", "twitch"] as const)


export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.redirect(new URL("/settings/profile?linked=0", request.url))

    const { searchParams } = new URL(request.url)
    const provider = ((searchParams.get("provider") || "").toLowerCase()) as "github" | "reddit" | "twitch"
    const state = searchParams.get("state") || ""
    if (!OAUTH_PROVIDERS.has(provider)) {
      return NextResponse.redirect(new URL("/settings/profile?linked=0&error=provider", request.url))
    }

    const cookieStore = await cookies()
    const stateCookie = cookieStore.get("vtx_oauth_link_state")?.value
    cookieStore.delete("vtx_oauth_link_state")

    if (!stateCookie || stateCookie !== `${provider}:${state}`) {
      return NextResponse.redirect(new URL("/settings/profile?linked=0&error=state", request.url))
    }

    const { data: identities } = await (supabase.auth as unknown as { getUserIdentities?: () => Promise<{ data: { identities: Array<{ provider: string; id: string; identity_data?: Record<string, string> }> } }> }).getUserIdentities?.() ?? { data: { identities: [] } }
    const matched = (identities?.identities || []).find((entry: { provider: string }) => entry.provider === provider)
    if (!matched?.id) {
      return NextResponse.redirect(new URL("/settings/profile?linked=0&error=identity", request.url))
    }

    await supabase.from("user_connections").upsert({
      user_id: auth.user.id,
      provider,
      provider_user_id: matched.id,
      username: matched.identity_data?.user_name || matched.identity_data?.email || matched.id,
      display_name: matched.identity_data?.full_name || null,
      profile_url: matched.identity_data?.profile_url || null,
      metadata: { linked_via: "oauth", identity_id: matched.id },
    }, { onConflict: "user_id,provider" })

    return NextResponse.redirect(new URL("/settings/profile?linked=1", request.url))

  } catch (err) {
    console.error("[users/connections/oauth/callback GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
