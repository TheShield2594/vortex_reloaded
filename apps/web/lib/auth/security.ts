import crypto from "node:crypto"
import { cookies } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { base64url, tokenHash } from "@/lib/auth/passkeys"
import { untypedFrom } from "@/lib/supabase/untyped-table"

const TRUSTED_COOKIE = "vtx_trusted_device"

export async function issueTrustedDevice(userId: string, label: string) {
  const rawToken = base64url(crypto.randomBytes(32))
  const hash = tokenHash(rawToken)
  const supabase = await createServiceRoleClient()
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)

  const { data, error } = await untypedFrom(supabase, "auth_trusted_devices")
    .insert({ user_id: userId, label, token_hash: hash, expires_at: expiresAt.toISOString() })
    .select("id")
    .single()

  if (error || !data) throw error || new Error("Could not create trusted device")

  const cookieStore = await cookies()
  cookieStore.set(TRUSTED_COOKIE, `${data.id}:${rawToken}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  })

  return data.id
}

export async function clearTrustedDeviceCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(TRUSTED_COOKIE)
}

export async function createAuthSession(params: {
  userId: string
  trustedDeviceId?: string | null
  userAgent?: string | null
  ipAddress?: string | null
}) {
  const token = base64url(crypto.randomBytes(32))
  const hash = tokenHash(token)
  const supabase = await createServiceRoleClient()
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)

  await untypedFrom(supabase, "auth_sessions").insert({
    user_id: params.userId,
    trusted_device_id: params.trustedDeviceId ?? null,
    session_token_hash: hash,
    user_agent: params.userAgent ?? null,
    ip_address: params.ipAddress ?? null,
    expires_at: expiresAt.toISOString(),
  })

  return token
}
