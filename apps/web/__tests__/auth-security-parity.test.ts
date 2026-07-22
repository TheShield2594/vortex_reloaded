import { beforeEach, describe, expect, it, vi } from "vitest"

const getUserMock = vi.fn()
const updateUserByIdMock = vi.fn()
const signInWithPasswordMock = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock,
      signOut: vi.fn(async () => ({ error: null })),
    },
  })),
  createServiceRoleClient: vi.fn(async () => ({
    auth: {
      admin: {
        updateUserById: updateUserByIdMock,
      },
    },
  })),
}))

vi.mock("@/lib/auth/step-up", () => ({
  hasValidStepUpToken: vi.fn(async () => false),
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: vi.fn(async () => ({ error: null })),
    },
  })),
}))

describe("security parity guards", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } })
    signInWithPasswordMock.mockResolvedValue({ error: null })
    updateUserByIdMock.mockResolvedValue({ error: null })
  })

  it("enforces step-up before password change", async () => {
    const { PATCH } = await import("@/app/api/auth/password/route")
    const response = await PATCH(new Request("http://localhost/api/auth/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "current-password", newPassword: "very-secure-password" }),
    }))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toContain("Step-up")
    expect(updateUserByIdMock).not.toHaveBeenCalled()
  })

  it("flags suspicious login when both subnet and device change", async () => {
    const { computeLoginRisk } = await import("@/lib/auth/risk")
    const risk = computeLoginRisk(
      { userId: "user-1", ipAddress: "203.0.113.10", userAgent: "Chrome/123", locationHint: "US" },
      { ipAddress: "198.51.100.22", userAgent: "Safari/17", locationHint: "DE" }
    )

    expect(risk.suspicious).toBe(true)
    expect(risk.riskScore).toBeGreaterThanOrEqual(60)
    expect(risk.reasons).toContain("new_ip_subnet")
    expect(risk.reasons).toContain("new_device_signature")
  })
})
