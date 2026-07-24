import { describe, expect, it } from "vitest"
import {
  MAX_POLL_OPTIONS,
  POLL_NUMBER_EMOJIS,
  formatPollBlock,
  isPollVoteEmoji,
  parsePollBlock,
  tallyPollVotes,
} from "@/lib/poll"

const POLL = formatPollBlock("Lunch?", ["Tacos", "Ramen"])

describe("parsePollBlock", () => {
  it("parses a composer-generated poll block", () => {
    expect(parsePollBlock(POLL)).toEqual({
      question: "Lunch?",
      options: ["Tacos", "Ramen"],
      before: "",
      after: "",
    })
  })

  it("keeps surrounding message text", () => {
    const parsed = parsePollBlock(`Hey team\n\n${POLL}\n\nvote by EOD`)
    expect(parsed?.before).toBe("Hey team")
    expect(parsed?.after).toBe("vote by EOD")
  })

  it("returns null for messages without a poll block", () => {
    expect(parsePollBlock("just a message")).toBeNull()
    expect(parsePollBlock("")).toBeNull()
    expect(parsePollBlock(null)).toBeNull()
  })

  it("returns null when the block has fewer than two options", () => {
    expect(parsePollBlock("[POLL]\nLunch?\n- Tacos\n[/POLL]")).toBeNull()
  })

  it("returns null when the block has no question", () => {
    expect(parsePollBlock("[POLL]\n- Tacos\n- Ramen\n[/POLL]")).toBeNull()
  })

  it("ignores blank lines and non-bullet lines inside the block", () => {
    const parsed = parsePollBlock("[POLL]\n\nLunch?\n\n- Tacos\nnot an option\n- Ramen\n[/POLL]")
    expect(parsed?.question).toBe("Lunch?")
    expect(parsed?.options).toEqual(["Tacos", "Ramen"])
  })

  it("caps options at MAX_POLL_OPTIONS", () => {
    const many = Array.from({ length: MAX_POLL_OPTIONS + 3 }, (_, i) => `Option ${i + 1}`)
    const parsed = parsePollBlock(formatPollBlock("Pick one", many))
    expect(parsed?.options).toHaveLength(MAX_POLL_OPTIONS)
    expect(parsed?.options.at(-1)).toBe(`Option ${MAX_POLL_OPTIONS}`)
  })

  it("has one vote emoji per allowed option", () => {
    expect(POLL_NUMBER_EMOJIS).toHaveLength(MAX_POLL_OPTIONS)
    expect(new Set(POLL_NUMBER_EMOJIS).size).toBe(MAX_POLL_OPTIONS)
  })
})

describe("isPollVoteEmoji", () => {
  it("matches only emojis within the option range", () => {
    expect(isPollVoteEmoji(POLL_NUMBER_EMOJIS[0], 2)).toBe(true)
    expect(isPollVoteEmoji(POLL_NUMBER_EMOJIS[1], 2)).toBe(true)
    expect(isPollVoteEmoji(POLL_NUMBER_EMOJIS[2], 2)).toBe(false)
    expect(isPollVoteEmoji("🎉", 2)).toBe(false)
  })
})

describe("tallyPollVotes", () => {
  const options = ["Tacos", "Ramen"]

  it("reports an empty tally with no reactions", () => {
    const tally = tallyPollVotes(options, [], "me")
    expect(tally.totalVotes).toBe(0)
    expect(tally.voterCount).toBe(0)
    expect(tally.results.map((r) => r.votes)).toEqual([0, 0])
    expect(tally.results.map((r) => r.share)).toEqual([0, 0])
    expect(tally.results.map((r) => r.emoji)).toEqual([POLL_NUMBER_EMOJIS[0], POLL_NUMBER_EMOJIS[1]])
  })

  it("counts votes, shares, and the current user's own vote", () => {
    const tally = tallyPollVotes(options, [
      { emoji: POLL_NUMBER_EMOJIS[0], user_id: "me" },
      { emoji: POLL_NUMBER_EMOJIS[0], user_id: "alice" },
      { emoji: POLL_NUMBER_EMOJIS[0], user_id: "bob" },
      { emoji: POLL_NUMBER_EMOJIS[1], user_id: "alice" },
    ], "me")

    expect(tally.totalVotes).toBe(4)
    expect(tally.voterCount).toBe(3)
    expect(tally.results[0]).toMatchObject({ votes: 3, share: 75, hasOwnVote: true, label: "Tacos" })
    expect(tally.results[1]).toMatchObject({ votes: 1, share: 25, hasOwnVote: false, label: "Ramen" })
  })

  it("ignores plain reactions and vote emojis past the last option", () => {
    const tally = tallyPollVotes(options, [
      { emoji: "🎉", user_id: "alice" },
      { emoji: POLL_NUMBER_EMOJIS[7], user_id: "bob" },
    ], "me")

    expect(tally.totalVotes).toBe(0)
    expect(tally.voterCount).toBe(0)
    expect(tally.results.every((r) => r.votes === 0)).toBe(true)
  })
})
