interface ToastFn {
  (props: { variant?: "default" | "destructive"; title?: string }): void
}

interface RouterLike {
  push: (href: string) => void
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json()
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid server response shape")
  }
  return payload as Record<string, unknown>
}

/** Opens/creates a DM channel with a user and routes to the DM on success. */
export async function openDmChannel(userId: string, router: RouterLike, toast: ToastFn): Promise<void> {
  const response = await fetch("/api/dm/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [userId] }),
  })

  if (!response.ok) {
    let message = "Failed to open DM"
    try {
      const errorPayload = await parseJsonResponse(response)
      if (typeof errorPayload.error === "string") {
        message = errorPayload.error
      }
    } catch {
      // Keep fallback message when server body is not parseable JSON.
    }
    toast({ variant: "destructive", title: message })
    return
  }

  const payload = await parseJsonResponse(response)
  const channelId = payload.id
  if (typeof channelId !== "string") {
    throw new Error("Missing DM channel id")
  }
  router.push(`/channels/me/${channelId}`)
}

/** Sends a friend request and shows toast feedback (409 remains non-destructive). Returns true on success. */
export async function sendFriendRequest(username: string, toast: ToastFn): Promise<boolean> {
  try {
    const response = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    })

    let title = "Request completed"
    try {
      const payload = await parseJsonResponse(response)
      title =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.error === "string"
            ? payload.error
            : title
    } catch {
      // Malformed or non-JSON response — use fallback title
      if (!response.ok) {
        title = response.statusText || "Request failed"
      }
    }

    toast({
      variant: response.ok || response.status === 409 ? "default" : "destructive",
      title,
    })

    return response.ok
  } catch {
    toast({ variant: "destructive", title: "Network error while sending friend request" })
    return false
  }
}
