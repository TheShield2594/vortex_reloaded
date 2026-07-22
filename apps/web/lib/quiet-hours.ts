/**
 * Checks whether the current time falls within a user's configured quiet hours.
 * Used by the push notification path to suppress notifications during DND schedule.
 */
export function isInQuietHours(
  enabled: boolean | null | undefined,
  start: string | null | undefined,   // "HH:MM"
  end: string | null | undefined,     // "HH:MM"
  timezone: string | null | undefined  // IANA timezone (e.g. "America/New_York")
): boolean {
  if (!enabled) return false
  if (!start || !end || !timezone) return false

  let now: Date
  try {
    // Get current time in user's timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    const parts = formatter.formatToParts(new Date())
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10)
    now = new Date(2000, 0, 1, hour, minute)
  } catch {
    // Invalid timezone — fail open (don't suppress)
    return false
  }

  const startParts = start.split(":")
  const endParts = end.split(":")
  if (startParts.length < 2 || endParts.length < 2) return false

  const startH = Number(startParts[0])
  const startM = Number(startParts[1])
  const endH = Number(endParts[0])
  const endM = Number(endParts[1])

  if (!Number.isFinite(startH) || !Number.isFinite(startM) || !Number.isFinite(endH) || !Number.isFinite(endM)) return false
  if (startH < 0 || startH > 23 || startM < 0 || startM > 59) return false
  if (endH < 0 || endH > 23 || endM < 0 || endM > 59) return false

  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  if (startMinutes <= endMinutes) {
    // Same-day range (e.g., 09:00 → 17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  }
  // Overnight range (e.g., 22:00 → 08:00)
  return nowMinutes >= startMinutes || nowMinutes < endMinutes
}
