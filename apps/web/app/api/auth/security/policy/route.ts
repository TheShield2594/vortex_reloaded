import { headers } from "next/headers"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { authSecurityPolicies, createDb } from "@vortex/db"
import { auth } from "@/lib/auth/better-auth"

const db = createDb()

const DEFAULT_POLICY = {
  passkeyFirst: false,
  enforcePasskey: false,
  fallbackPassword: true,
  fallbackMagicLink: true,
}

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [row] = await db
      .select({
        passkeyFirst: authSecurityPolicies.passkeyFirst,
        enforcePasskey: authSecurityPolicies.enforcePasskey,
        fallbackPassword: authSecurityPolicies.fallbackPassword,
        fallbackMagicLink: authSecurityPolicies.fallbackMagicLink,
      })
      .from(authSecurityPolicies)
      .where(eq(authSecurityPolicies.userId, session.user.id))
      .limit(1)

    const policy = row ?? DEFAULT_POLICY
    return NextResponse.json({
      policy: {
        passkey_first: policy.passkeyFirst,
        enforce_passkey: policy.enforcePasskey,
        fallback_password: policy.fallbackPassword,
        fallback_magic_link: policy.fallbackMagicLink,
      },
    })
  } catch (err) {
    console.error("[auth/security/policy GET] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const patch = await request.json().catch(() => ({}))
    const values = {
      passkeyFirst: !!patch.passkey_first,
      enforcePasskey: !!patch.enforce_passkey,
      fallbackPassword: patch.fallback_password !== false,
      fallbackMagicLink: patch.fallback_magic_link !== false,
    }

    await db
      .insert(authSecurityPolicies)
      .values({ userId: session.user.id, ...values })
      .onConflictDoUpdate({ target: authSecurityPolicies.userId, set: values })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[auth/security/policy PATCH] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
