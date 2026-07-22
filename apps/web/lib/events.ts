export type EventRecurrence = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly"

export interface EventModel {
  id: string
  title: string
  description: string | null
  location?: string | null
  timezone: string
  start_at: string
  end_at: string
  recurrence: EventRecurrence
  recurrence_until: string | null
  capacity: number | null
  cancelled_at: string | null
}

export interface EventOccurrence {
  eventId: string
  title: string
  startAt: Date
  endAt: Date
  timezone: string
}

function stepDate(date: Date, recurrence: EventRecurrence): Date {
  const next = new Date(date)
  if (recurrence === "daily") next.setUTCDate(next.getUTCDate() + 1)
  if (recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7)
  if (recurrence === "biweekly") next.setUTCDate(next.getUTCDate() + 14)
  if (recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1)
  if (recurrence === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}

export function expandEventOccurrences(
  events: EventModel[],
  rangeStart: Date,
  rangeEnd: Date
): EventOccurrence[] {
  const occurrences: EventOccurrence[] = []

  for (const event of events) {
    if (event.cancelled_at) continue

    const baseStart = new Date(event.start_at)
    const durationMs = new Date(event.end_at).getTime() - baseStart.getTime()
    const until = event.recurrence_until ? new Date(event.recurrence_until) : null

    if (event.recurrence === "none") {
      if (baseStart >= rangeStart && baseStart <= rangeEnd) {
        occurrences.push({
          eventId: event.id,
          title: event.title,
          startAt: baseStart,
          endAt: new Date(baseStart.getTime() + durationMs),
          timezone: event.timezone,
        })
      }
      continue
    }

    let cursor = new Date(baseStart)
    let guard = 0
    while (cursor <= rangeEnd && guard < 500) {
      if (until && cursor > until) break

      if (cursor >= rangeStart) {
        occurrences.push({
          eventId: event.id,
          title: event.title,
          startAt: new Date(cursor),
          endAt: new Date(cursor.getTime() + durationMs),
          timezone: event.timezone,
        })
      }

      cursor = stepDate(cursor, event.recurrence)
      guard += 1
    }
  }

  return occurrences.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export function formatInTimeZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso))
}

export function buildICal(events: EventModel[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VortexChat//Events//EN"]

  for (const event of events) {
    const start = new Date(event.start_at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
    const end = new Date(event.end_at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
    lines.push("BEGIN:VEVENT")
    lines.push(`UID:${event.id}@vortexchat`)
    lines.push(`SUMMARY:${event.title.replace(/\n/g, " ")}`)
    if (event.description) lines.push(`DESCRIPTION:${event.description.replace(/\n/g, " ")}`)
    lines.push(`DTSTART:${start}`)
    lines.push(`DTEND:${end}`)
    if (event.recurrence !== "none") {
      let freq: string
      let interval = ""
      if (event.recurrence === "biweekly") {
        freq = "WEEKLY"
        interval = ";INTERVAL=2"
      } else {
        freq = event.recurrence.toUpperCase()
      }
      const until = event.recurrence_until
        ? `;UNTIL=${new Date(event.recurrence_until).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`
        : ""
      lines.push(`RRULE:FREQ=${freq}${interval}${until}`)
    }
    lines.push("END:VEVENT")
  }

  lines.push("END:VCALENDAR")
  return `${lines.join("\r\n")}\r\n`
}
