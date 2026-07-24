/**
 * Poll block format shared by the composer (`use-poll-creator`) and the DM
 * message renderer (`components/dm/dm-poll`).
 *
 * A poll is stored inline in the message body so it survives end-to-end
 * encryption — there is no server-side poll table. Votes ride on the existing
 * DM reaction system: option N is voted by reacting with POLL_NUMBER_EMOJIS[N].
 *
 *   [POLL]
 *   Question?
 *   - Option one
 *   - Option two
 *   [/POLL]
 */

/** Emoji used to vote for each poll option, by index. */
export const POLL_NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"] as const

/** Maximum number of poll options — one per vote emoji. */
export const MAX_POLL_OPTIONS = POLL_NUMBER_EMOJIS.length

/** Minimum number of options for a block to be a valid poll. */
export const MIN_POLL_OPTIONS = 2

export interface ParsedPoll {
  question: string
  options: string[]
  /** Message text before the poll block, if any. */
  before: string
  /** Message text after the poll block, if any. */
  after: string
}

export interface PollOptionResult {
  index: number
  label: string
  emoji: string
  votes: number
  /** Share of the total votes cast, 0–100. */
  share: number
  hasOwnVote: boolean
}

export interface PollTally {
  results: PollOptionResult[]
  /** Total votes cast across all options. */
  totalVotes: number
  /** Distinct users who voted for at least one option. */
  voterCount: number
}

const POLL_BLOCK_RE = /\[POLL\]([\s\S]*?)\[\/POLL\]/

/** Build the inline poll block inserted into the composer draft. */
export function formatPollBlock(question: string, options: readonly string[]): string {
  return ["[POLL]", question, ...options.map((option) => `- ${option}`), "[/POLL]"].join("\n")
}

/**
 * Extract a poll from a message body. Returns null when the message has no
 * poll block, no question, or fewer than MIN_POLL_OPTIONS options — such a
 * message falls back to plain-text rendering.
 */
export function parsePollBlock(content: string | null | undefined): ParsedPoll | null {
  if (!content) return null
  const match = POLL_BLOCK_RE.exec(content)
  if (!match) return null

  const lines = match[1].split("\n").map((line) => line.trim()).filter(Boolean)
  const question = lines[0]
  // A block that opens with an option bullet has no question — not a poll.
  if (!question || question.startsWith("- ")) return null

  const options: string[] = []
  for (const line of lines.slice(1)) {
    if (!line.startsWith("- ")) continue
    const option = line.slice(2).trim()
    if (option) options.push(option)
    if (options.length === MAX_POLL_OPTIONS) break
  }
  if (options.length < MIN_POLL_OPTIONS) return null

  return {
    question,
    options,
    before: content.slice(0, match.index).trim(),
    after: content.slice(match.index + match[0].length).trim(),
  }
}

/** True when `emoji` votes for one of the first `optionCount` poll options. */
export function isPollVoteEmoji(emoji: string, optionCount: number): boolean {
  const index = POLL_NUMBER_EMOJIS.indexOf(emoji as (typeof POLL_NUMBER_EMOJIS)[number])
  return index >= 0 && index < optionCount
}

/** Tally poll votes from the message's reactions. */
export function tallyPollVotes(
  options: readonly string[],
  reactions: ReadonlyArray<{ emoji: string; user_id: string }>,
  currentUserId: string
): PollTally {
  const voters = new Set<string>()
  const results: PollOptionResult[] = options.slice(0, MAX_POLL_OPTIONS).map((label, index) => ({
    index,
    label,
    emoji: POLL_NUMBER_EMOJIS[index],
    votes: 0,
    share: 0,
    hasOwnVote: false,
  }))

  let totalVotes = 0
  for (const reaction of reactions) {
    const index = POLL_NUMBER_EMOJIS.indexOf(reaction.emoji as (typeof POLL_NUMBER_EMOJIS)[number])
    const result = index >= 0 ? results[index] : undefined
    if (!result) continue
    result.votes++
    totalVotes++
    voters.add(reaction.user_id)
    if (reaction.user_id === currentUserId) result.hasOwnVote = true
  }

  if (totalVotes > 0) {
    for (const result of results) result.share = Math.round((result.votes / totalVotes) * 100)
  }

  return { results, totalVotes, voterCount: voters.size }
}
