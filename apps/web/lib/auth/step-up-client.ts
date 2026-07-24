/**
 * Browser-side wrapper around `/api/auth/step-up`.
 *
 * Sensitive Better Auth calls (`twoFactor.disable`, `linkSocial`) are refused
 * with "Step-up authentication required" until the user re-proves a credential
 * here. Callers should re-authenticate *first* and then issue the gated call,
 * rather than firing it, parsing the 403 and retrying — the token is
 * single-use, so a speculative first attempt would burn nothing but would make
 * every gated action cost a guaranteed round-trip failure.
 */

export interface StepUpMethods {
  password: boolean
  totp: boolean
}

export interface StepUpStatus {
  /** A live token is already held — the gated action can go ahead unprompted. */
  verified: boolean
  methods: StepUpMethods
}

const NO_METHODS: StepUpMethods = { password: false, totp: false }

/** Fetch what the user would be challenged for, and whether they need to be. */
export async function getStepUpStatus(): Promise<StepUpStatus | null> {
  try {
    const res = await fetch("/api/auth/step-up", { cache: "no-store" })
    if (!res.ok) return null
    const payload = (await res.json()) as Partial<StepUpStatus>
    return {
      verified: !!payload.verified,
      methods: { ...NO_METHODS, ...(payload.methods ?? {}) },
    }
  } catch {
    return null
  }
}

/**
 * Submit a factor and mint the token. An empty payload is only valid for an
 * account with no password and no 2FA — the server decides, not the caller.
 */
export async function submitStepUp(
  payload: { password?: string; totpCode?: string } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/auth/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: body.error || "Verification failed" }
  } catch {
    return { ok: false, error: "Verification failed" }
  }
}
