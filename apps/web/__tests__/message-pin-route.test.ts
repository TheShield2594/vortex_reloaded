import { describe, expect, it, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"
import { DELETE, PUT } from "@/app/api/messages/[messageId]/pin/route"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getChannelPermissions, hasPermission } from "@/lib/permissions"
import { sendPushToChannel } from "@/lib/push"

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({
  getChannelPermissions: vi.fn(),
  hasPermission: vi.fn(),
}))

vi.mock("@/lib/push", () => ({
  sendPushToChannel: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })),
}))

type SupabaseMock = ReturnType<typeof createSupabaseMock>

function createSupabaseMock() {
  const updateMock = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
  const insertMock = vi.fn(async () => ({ error: null }))

  const messageSingleMock = vi.fn(async () => ({
    data: { id: "m1", channel_id: "c1", channels: { server_id: "s1" } },
  }))

  const messagesSelectChain = {
    eq: vi.fn(() => messagesSelectChain),
    is: vi.fn(() => messagesSelectChain),
    single: messageSingleMock,
  }

  const messagesTable = {
    select: vi.fn(() => messagesSelectChain),
    update: updateMock,
  }

  const auditTable = {
    insert: insertMock,
  }

  const usersMaybeSingleMock = vi.fn(async () => ({
    data: { display_name: "TestUser", username: "testuser" },
  }))

  const usersSelectChain = {
    eq: vi.fn(() => usersSelectChain),
    maybeSingle: usersMaybeSingleMock,
  }

  const usersTable = {
    select: vi.fn(() => usersSelectChain),
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "messages") return messagesTable
      if (table === "audit_logs") return auditTable
      if (table === "users") return usersTable
      throw new Error(`Unexpected table: ${table}`)
    }),
    __mocks: {
      updateMock,
      insertMock,
      messageSingleMock,
      messagesTable,
      messagesSelectChain,
      usersMaybeSingleMock,
    },
  }
}

describe("message pin route lifecycle", () => {
  let supabase: SupabaseMock

  beforeEach(() => {
    supabase = createSupabaseMock()
    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never)
    vi.mocked(getChannelPermissions).mockResolvedValue({ isAdmin: false, permissions: 0 } as never)
    vi.mocked(hasPermission).mockReturnValue(true)
  })

  it("pins a message and writes an audit log when permission checks pass", async () => {
    const response = await PUT({} as NextRequest, { params: Promise.resolve({ messageId: "m1" }) })

    expect(response.status).toBe(200)
    expect(vi.mocked(getChannelPermissions)).toHaveBeenCalledWith(supabase, "s1", "c1", "u1")
    expect(supabase.__mocks.updateMock).toHaveBeenCalledWith(expect.objectContaining({ pinned: true, pinned_by: "u1" }))
    expect(supabase.__mocks.insertMock).toHaveBeenCalledWith(expect.objectContaining({ action: "message_pin", target_id: "m1" }))
    expect(vi.mocked(sendPushToChannel)).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "s1",
        channelId: "c1",
        senderName: "📌 TestUser",
        content: "pinned a message",
        excludeUserId: "u1",
      })
    )
  })

  it("rejects pin attempts without MANAGE_MESSAGES", async () => {
    vi.mocked(hasPermission).mockReturnValue(false)

    const response = await PUT({} as NextRequest, { params: Promise.resolve({ messageId: "m1" }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Missing MANAGE_MESSAGES permission" })
    expect(supabase.__mocks.updateMock).not.toHaveBeenCalled()
  })

  it("unpins a message through the same channel-scoped permission path", async () => {
    const response = await DELETE({} as NextRequest, { params: Promise.resolve({ messageId: "m1" }) })

    expect(response.status).toBe(200)
    expect(vi.mocked(getChannelPermissions)).toHaveBeenCalledWith(supabase, "s1", "c1", "u1")
    expect(supabase.__mocks.updateMock).toHaveBeenCalledWith({ pinned: false, pinned_at: null, pinned_by: null })
  })
})
