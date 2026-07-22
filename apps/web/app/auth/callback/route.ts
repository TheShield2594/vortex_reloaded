import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const rawNext = searchParams.get("next") ?? ""
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/channels/me"

  if (code) {
    // Build the redirect response first so we can attach cookies directly to it.
    // Using the cached createServerSupabaseClient() here would set cookies via
    // cookieStore.set(), but those aren't guaranteed to appear on a separately
    // constructed NextResponse — especially on mobile browsers that are strict
    // about Set-Cookie headers on redirects.  Creating a dedicated client that
    // writes straight to the response object is the pattern recommended by
    // @supabase/ssr for Route Handler callbacks.
    const redirectResponse = NextResponse.redirect(`${origin}${next}`)

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              redirectResponse.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error("Auth callback: code exchange failed", error)
    } else {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) {
        console.error("Auth callback: getUser() failed", userError)
      } else if (user) {
        const { error: statusError } = await supabase.from("users").update({ status: "online" }).eq("id", user.id)
        if (statusError) {
          console.error("Auth callback: failed to set user status to online", statusError)
        }
      }
      return redirectResponse
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
