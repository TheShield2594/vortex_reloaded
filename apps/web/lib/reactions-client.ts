const inFlight = new Map<string, Promise<void>>()

export async function sendReactionMutation(params: {
  messageId: string
  emoji: string
  remove: boolean
  nonce: string
}): Promise<void> {
  const key = `${params.messageId}:${params.emoji}`
  const previous = inFlight.get(key) ?? Promise.resolve()

  const next = previous
    .catch(() => {})
    .then(async () => {
      const res = await fetch(`/api/messages/${params.messageId}/reactions`, {
        method: params.remove ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji: params.emoji, nonce: params.nonce }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to update reaction")
      }
    })
    .finally(() => {
      if (inFlight.get(key) === next) {
        inFlight.delete(key)
      }
    })

  inFlight.set(key, next)
  return next
}
