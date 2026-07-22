import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

export async function updateSession(
  request: NextRequest,
  extraHeaders?: Headers,
) {
  // Merge any extra headers (e.g. CSP nonce) into the forwarded request so
  // downstream server components can read them via headers().
  const forwardedRequest = extraHeaders
    ? { headers: extraHeaders }
    : { headers: request.headers }

  let supabaseResponse = NextResponse.next({
    request: forwardedRequest,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request: forwardedRequest,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: getUserError } = await supabase.auth.getUser()

  if (getUserError) {
    // Auth token invalid or Supabase unreachable — treat as unauthenticated
    return { response: supabaseResponse, user: null }
  }

  return { response: supabaseResponse, user }
}
