"use client"

interface CustomEmoji {
  id: string
  name: string
  image_url: string
}

interface ServerEmojiGroup {
  server: { id: string; name: string; icon_url: string | null }
  emojis: CustomEmoji[]
}

interface Props {
  /** Flat list of custom emojis (used in server chat where all emojis belong to one server). */
  emojis?: CustomEmoji[]
  /** Grouped by server (used in DMs where emojis come from multiple servers). */
  groups?: ServerEmojiGroup[]
  /** Search query to filter custom emojis by name. */
  search?: string
  /** Callback when a custom emoji is selected. Receives the emoji name (without colons). */
  onSelect: (emoji: CustomEmoji) => void
}

/** Grid of custom emoji images shown above the standard emoji picker.
 *  Supports both flat (single server) and grouped (multi-server) layouts. */
export function CustomEmojiGrid({ emojis, groups, search, onSelect }: Props) {
  const query = (search ?? "").toLowerCase().trim()

  if (groups && groups.length > 0) {
    const filtered = groups
      .map((g) => ({
        ...g,
        emojis: query ? g.emojis.filter((e) => e.name.toLowerCase().includes(query)) : g.emojis,
      }))
      .filter((g) => g.emojis.length > 0)

    if (filtered.length === 0) return null

    return (
      <div>
        {filtered.map((group) => (
          <div key={group.server.id}>
            <div
              style={{
                padding: "3px 8px",
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--theme-text-muted)",
                background: "var(--theme-bg-secondary)",
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              {group.server.name}
            </div>
            <EmojiGrid emojis={group.emojis} onSelect={onSelect} />
          </div>
        ))}
      </div>
    )
  }

  if (emojis && emojis.length > 0) {
    const filtered = query ? emojis.filter((e) => e.name.toLowerCase().includes(query)) : emojis
    if (filtered.length === 0) return null

    return (
      <div>
        <div
          style={{
            padding: "3px 8px",
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--theme-text-muted)",
            background: "var(--theme-bg-secondary)",
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          Custom
        </div>
        <EmojiGrid emojis={filtered} onSelect={onSelect} />
      </div>
    )
  }

  return null
}

function EmojiGrid({ emojis, onSelect }: { emojis: CustomEmoji[]; onSelect: (e: CustomEmoji) => void }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(9, 1fr)",
        gap: "2px",
        padding: "2px 4px",
      }}
    >
      {emojis.map((e) => (
        <button
          key={e.id}
          type="button"
          data-emoji-btn=""
          className="custom-emoji-btn"
          tabIndex={-1}
          onClick={() => onSelect(e)}
          title={`:${e.name}:`}
          aria-label={`:${e.name}:`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            aspectRatio: "1",
            borderRadius: "4px",
            cursor: "pointer",
            border: "none",
            background: "transparent",
            padding: "4px",
          }}
        >
          <img
            src={e.image_url}
            alt={`:${e.name}:`}
            loading="lazy"
            draggable={false}
            style={{ width: "22px", height: "22px", objectFit: "contain" }}
          />
        </button>
      ))}
    </div>
  )
}
