const RESERVED_PREFIXES = [
  "/channels/me",
  "/channels/notifications",
  "/channels/you",
  "/channels/friends",
  "/channels/discover",
  "/channels/servers",
  "/channels/profile",
]

function isServerRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/channels/") &&
    !RESERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )
}

/** True when the user is inside a full-screen channel view (server channel or DM conversation). */
export function isFullScreenChannel(pathname: string): boolean {
  // /channels/me/:channelId — DM conversation
  if (pathname.startsWith("/channels/me/") && pathname.split("/").length >= 4) return true
  // /channels/:serverId/:channelId — server channel (not a reserved route)
  if (isServerRoute(pathname) && pathname.split("/").length >= 4) return true
  return false
}
