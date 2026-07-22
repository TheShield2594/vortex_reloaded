"use client"

import { Hash } from "lucide-react"

interface ProfileInterestTagsProps {
  tags: string[]
  /** If provided and user hovers a tag that exists in `sharedTags`, it highlights */
  sharedTags?: string[]
}

/**
 * Displays a user's interest tags as compact inline pills.
 * Empty state is handled gracefully with a muted placeholder.
 *
 * Design: minimal pill — no border, slightly elevated background, subtle accent
 * on shared tags. Keeps the profile feeling calm and not cluttered.
 */
export function ProfileInterestTags({ tags, sharedTags = [] }: ProfileInterestTagsProps) {
  if (tags.length === 0) {
    return (
      <p className="text-xs italic" style={{ color: "var(--theme-text-muted)" }}>
        No interests yet
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Interests">
      {tags.map((tag) => {
        const isShared = sharedTags.includes(tag)
        return (
          <span
            key={tag}
            role="listitem"
            title={isShared ? "Shared interest" : undefined}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium select-none"
            style={{
              background: isShared
                ? "color-mix(in srgb, var(--theme-accent) 18%, transparent)"
                : "var(--theme-bg-tertiary)",
              color: isShared ? "var(--theme-accent)" : "var(--theme-text-secondary)",
              border: isShared ? "1px solid color-mix(in srgb, var(--theme-accent) 40%, transparent)" : "none",
            }}
          >
            <Hash className="w-2.5 h-2.5 flex-shrink-0" aria-hidden />
            {tag}
          </span>
        )
      })}
    </div>
  )
}
