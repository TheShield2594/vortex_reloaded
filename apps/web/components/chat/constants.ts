/**
 * Maximum number of messages to keep in client state.
 * The virtualizer only renders visible rows, so this can be larger than
 * the old DOM-based cap of 150.
 *
 * Used by: chat-area, use-chat-history, use-chat-realtime.
 */
export const DISPLAY_LIMIT = 500
