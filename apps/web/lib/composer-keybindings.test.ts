import { describe, expect, it } from "vitest"
import { resolveComposerKeybinding } from "@/lib/composer-keybindings"

const baseState = {
  isMentionOpen: false,
  hasMentionSelection: false,
  isEmojiOpen: false,
  hasEmojiSelection: false,
  isSlashOpen: false,
  hasSlashSelection: false,
  hasDraftContent: false,
  mentionHandledNavigation: false,
  emojiHandledNavigation: false,
  slashHandledNavigation: false,
  isMobile: false,
}

describe("resolveComposerKeybinding", () => {
  it("sends on Enter", () => {
    const action = resolveComposerKeybinding("Enter", false, baseState)
    expect(action).toEqual({
      preventDefault: true,
      sendMessage: true,
      acceptMention: false,
      closeMention: false,
      acceptEmoji: false,
      closeEmoji: false,
      acceptSlash: false,
      closeSlash: false,
      clearDraft: false,
    })
  })

  it("allows newline on Shift+Enter", () => {
    const action = resolveComposerKeybinding("Enter", true, baseState)
    expect(action.sendMessage).toBe(false)
    expect(action.preventDefault).toBe(false)
  })

  it("accepts mention on Tab", () => {
    const action = resolveComposerKeybinding("Tab", false, {
      ...baseState,
      isMentionOpen: true,
      hasMentionSelection: true,
    })

    expect(action.acceptMention).toBe(true)
    expect(action.preventDefault).toBe(true)
    expect(action.sendMessage).toBe(false)
  })

  it("accepts mention on Enter without shift", () => {
    const action = resolveComposerKeybinding("Enter", false, {
      ...baseState,
      isMentionOpen: true,
      hasMentionSelection: true,
    })

    expect(action.acceptMention).toBe(true)
    expect(action.sendMessage).toBe(false)
  })

  it("closes mention picker on Escape before clearing draft", () => {
    const closeMention = resolveComposerKeybinding("Escape", false, {
      ...baseState,
      isMentionOpen: true,
      hasDraftContent: true,
    })
    expect(closeMention.closeMention).toBe(true)
    expect(closeMention.clearDraft).toBe(false)

    const clearDraft = resolveComposerKeybinding("Escape", false, {
      ...baseState,
      isMentionOpen: false,
      hasDraftContent: true,
    })
    expect(clearDraft.closeMention).toBe(false)
    expect(clearDraft.clearDraft).toBe(true)
  })

  it("does not accept mention with Shift+Enter", () => {
    const action = resolveComposerKeybinding("Enter", true, {
      ...baseState,
      isMentionOpen: true,
      hasMentionSelection: true,
    })

    expect(action.acceptMention).toBe(false)
    expect(action.sendMessage).toBe(false)
    expect(action.preventDefault).toBe(false)
  })

  it("inserts newline on Enter when on mobile", () => {
    const action = resolveComposerKeybinding("Enter", false, {
      ...baseState,
      isMobile: true,
    })
    expect(action.sendMessage).toBe(false)
    expect(action.preventDefault).toBe(false)
  })

  it("respects mention navigation handlers", () => {
    const action = resolveComposerKeybinding("ArrowDown", false, {
      ...baseState,
      isMentionOpen: true,
      mentionHandledNavigation: true,
    })

    expect(action.preventDefault).toBe(true)
    expect(action.sendMessage).toBe(false)
    expect(action.acceptMention).toBe(false)
  })
})
