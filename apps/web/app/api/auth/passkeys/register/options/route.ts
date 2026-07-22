import { NextResponse } from "next/server"
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server"
import { getRpId, PASSKEY_CHALLENGE_TTL_SECONDS, randomChallenge, resolveRequestOrigin } from "@/lib/auth/passkeys"
import { untypedFrom } from "@/lib/supabase/untyped-table"

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()

    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const challenge = randomChallenge()
    const expiresAt = new Date(Date.now() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000).toISOString()
    const origin = resolveRequestOrigin(request.headers)
    const rpID = getRpId(origin)

    const admin = await createServiceRoleClient()
    const { error: insertError } = await untypedFrom(admin, "auth_challenges").insert({
      user_id: auth.user.id,
      flow: "register",
      challenge,
      rp_id: rpID,
      origin,
      expires_at: expiresAt,
    })

    if (insertError) {
      console.error("[auth/passkeys/register/options POST] insert error:", insertError.message)
      return NextResponse.json({ error: "Failed to create challenge" }, { status: 500 })
    }

    const { data: existing } = await untypedFrom(admin, "passkey_credentials")
      .select("credential_id")
      .eq("user_id", auth.user.id)
      .is("revoked_at", null)

    return NextResponse.json({
      challenge,
      rp: { id: rpID, name: "Vortex" },
      user: {
        id: auth.user.id,
        name: auth.user.email ?? auth.user.id,
        displayName: (auth.user.user_metadata.display_name as string | undefined) ?? auth.user.email ?? "Vortex User",
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
      attestation: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      excludeCredentials: (existing || []).map((row: { credential_id: string }) => ({ id: row.credential_id, type: "public-key" })),
    })

  } catch (err) {
    console.error("[auth/passkeys/register/options POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
