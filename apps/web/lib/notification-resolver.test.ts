import { describe, expect, it } from "vitest"
import { resolveNotification, type NotificationSetting } from "./notification-resolver"

const USER = "user-1"
const SERVER = "server-1"
const CHANNEL = "channel-1"
const THREAD = "thread-1"

function setting(partial: Partial<NotificationSetting>): NotificationSetting {
  return {
    user_id: USER,
    mode: "all",
    server_id: null,
    channel_id: null,
    thread_id: null,
    ...partial,
  }
}

describe("resolveNotification precedence", () => {
  it("uses explicit thread override over channel/server/global", () => {
    const settings: NotificationSetting[] = [
      setting({ mode: "all" }),
      setting({ server_id: SERVER, mode: "all" }),
      setting({ channel_id: CHANNEL, mode: "all" }),
      setting({ thread_id: THREAD, mode: "muted" }),
    ]

    const resolved = resolveNotification(USER, SERVER, CHANNEL, THREAD, "mention", settings)
    expect(resolved).toMatchObject({ mode: "muted", shouldPush: false, shouldBadge: false })
  })

  it("supports mention-only channels", () => {
    const settings = [setting({ channel_id: CHANNEL, mode: "mentions" })]

    expect(resolveNotification(USER, SERVER, CHANNEL, null, "message", settings)).toMatchObject({
      mode: "mentions",
      shouldPush: false,
      shouldBadge: false,
    })

    expect(resolveNotification(USER, SERVER, CHANNEL, null, "mention", settings)).toMatchObject({
      mode: "mentions",
      shouldPush: true,
      shouldBadge: true,
    })
  })

  it("handles muted thread inside unmuted channel", () => {
    const settings = [
      setting({ channel_id: CHANNEL, mode: "all" }),
      setting({ thread_id: THREAD, mode: "muted" }),
    ]

    const resolved = resolveNotification(USER, SERVER, CHANNEL, THREAD, "mention", settings)
    expect(resolved).toMatchObject({ mode: "muted", shouldPush: false, shouldBadge: false })
  })

  it("handles muted server with unmuted channel", () => {
    const settings = [
      setting({ server_id: SERVER, mode: "muted" }),
      setting({ channel_id: CHANNEL, mode: "all" }),
    ]

    const resolved = resolveNotification(USER, SERVER, CHANNEL, null, "message", settings)
    expect(resolved).toMatchObject({ mode: "all", shouldPush: true, shouldBadge: true })
  })

  it("muted channel suppresses badge and push", () => {
    const settings = [setting({ channel_id: CHANNEL, mode: "muted" })]

    const resolved = resolveNotification(USER, SERVER, CHANNEL, null, "mention", settings)
    expect(resolved.shouldPush).toBe(false)
    expect(resolved.shouldBadge).toBe(false)
  })

  it("does not double-notify on mention events", () => {
    const settings = [setting({ channel_id: CHANNEL, mode: "all" })]

    const mentionResult = resolveNotification(USER, SERVER, CHANNEL, null, "mention", settings)
    const messageResult = resolveNotification(USER, SERVER, CHANNEL, null, "message", settings)

    expect(mentionResult.shouldPush).toBe(true)
    expect(messageResult.shouldPush).toBe(true)
    expect(Number(mentionResult.shouldPush)).toBe(1)
  })
})
