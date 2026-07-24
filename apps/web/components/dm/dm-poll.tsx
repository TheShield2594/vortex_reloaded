"use client"

import { BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils/cn"
import { tallyPollVotes, type ParsedPoll } from "@/lib/poll"

interface Props {
  poll: ParsedPoll
  reactions: ReadonlyArray<{ emoji: string; user_id: string }>
  currentUserId: string
  /** Toggles the vote reaction for an option. */
  onVote: (emoji: string) => void
}

/**
 * Renders an inline [POLL] block with live results. Voting toggles the option's
 * number-emoji reaction on the message, so votes persist and sync over the
 * gateway like any other DM reaction.
 */
export function DmPoll({ poll, reactions, currentUserId, onVote }: Props) {
  const { results, totalVotes, voterCount } = tallyPollVotes(poll.options, reactions, currentUserId)

  return (
    <div className="dm-poll-surface mt-1 max-w-md rounded-md border p-3">
      <div className="flex items-start gap-2">
        <BarChart3 className="dm-poll-icon w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm font-semibold chat-area-text-bright break-words">{poll.question}</p>
      </div>

      <ul className="mt-2 space-y-1.5">
        {results.map((result) => (
          <li key={result.emoji}>
            <button
              type="button"
              onClick={() => onVote(result.emoji)}
              aria-pressed={result.hasOwnVote}
              aria-label={`${result.hasOwnVote ? "Remove vote for" : "Vote for"} ${result.label} — ${result.votes} ${result.votes === 1 ? "vote" : "votes"}`}
              className={cn(
                "dm-poll-option motion-interactive motion-press focus-ring relative w-full overflow-hidden rounded px-2 py-1.5 text-left",
                result.hasOwnVote && "dm-poll-option-voted"
              )}
            >
              <span className="dm-poll-bar" style={{ width: `${result.share}%` }} aria-hidden="true" />
              <span className="relative flex items-center gap-2">
                <span aria-hidden="true" className="text-sm flex-shrink-0">{result.emoji}</span>
                <span className="dm-poll-text flex-1 text-sm break-words">{result.label}</span>
                <span className="chat-area-text-muted text-xs tabular-nums flex-shrink-0">
                  {result.votes}
                  {totalVotes > 0 && ` · ${result.share}%`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="chat-area-text-muted text-xs mt-2">
        {totalVotes === 0
          ? "No votes yet — pick an option to vote."
          : `${totalVotes} ${totalVotes === 1 ? "vote" : "votes"} from ${voterCount} ${voterCount === 1 ? "person" : "people"}`}
      </p>
    </div>
  )
}
