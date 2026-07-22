import { decodeBase64Url, encodeBase64Url } from "@/lib/auth/base64url"

export function supportsPasskeys() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials
}

export async function startPasskeyRegistration(emailLabel?: string) {
  const optionsRes = await fetch("/api/auth/passkeys/register/options", { method: "POST" })
  const options = await optionsRes.json()
  if (!optionsRes.ok) throw new Error(options.error || "Could not initialize passkey setup")

  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: decodeBase64Url(options.challenge),
      user: {
        ...options.user,
        id: decodeBase64Url(options.user.id),
      },
      excludeCredentials: (options.excludeCredentials || []).map((cred: { id: string; type: string }) => ({
        ...cred,
        id: decodeBase64Url(cred.id),
      })),
    },
  }) as PublicKeyCredential

  const authResp = credential.response as AuthenticatorAttestationResponse

  const verifyRes = await fetch("/api/auth/passkeys/register/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challenge: options.challenge,
      credentialId: credential.id,
      name: emailLabel || "This device",
      response: {
        attestationObject: encodeBase64Url(authResp.attestationObject),
        clientDataJSON: encodeBase64Url(authResp.clientDataJSON),
      },
      transports: authResp.getTransports?.() || [],
    }),
  })

  const verified = await verifyRes.json()
  if (!verifyRes.ok) throw new Error(verified.error || "Passkey registration failed")
}

export async function startPasskeyLogin(email?: string, trustedDeviceLabel?: string) {
  const optionsRes = await fetch("/api/auth/passkeys/login/options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  })
  const options = await optionsRes.json()
  if (!optionsRes.ok) throw new Error(options.error || "Could not initialize passkey login")

  const assertion = await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: decodeBase64Url(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((cred: { id: string; type: string }) => ({
        ...cred,
        id: decodeBase64Url(cred.id),
      })),
    },
  }) as PublicKeyCredential

  const authResp = assertion.response as AuthenticatorAssertionResponse

  const verifyRes = await fetch("/api/auth/passkeys/login/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challenge: options.challenge,
      credentialId: assertion.id,
      trustedDeviceLabel,
      response: {
        authenticatorData: encodeBase64Url(authResp.authenticatorData),
        clientDataJSON: encodeBase64Url(authResp.clientDataJSON),
        signature: encodeBase64Url(authResp.signature),
        userHandle: authResp.userHandle ? encodeBase64Url(authResp.userHandle) : null,
      },
    }),
  })

  const verified = await verifyRes.json()
  if (!verifyRes.ok) throw new Error(verified.error || "Passkey login failed")

  // Session cookies are now set by the verify endpoint — navigate to the app
  window.location.href = "/channels/me"

  return options.policy as {
    passkey_first: boolean
    enforce_passkey: boolean
    fallback_password: boolean
    fallback_magic_link: boolean
  } | undefined
}
