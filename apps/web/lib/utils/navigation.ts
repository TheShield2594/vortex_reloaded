/** True when the user is inside a full-screen channel view (a DM conversation). */
export function isFullScreenChannel(pathname: string): boolean {
  // /channels/me/:channelId — DM conversation
  return pathname.startsWith("/channels/me/") && pathname.split("/").length >= 4
}
