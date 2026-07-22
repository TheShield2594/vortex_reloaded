"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Calendar, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { expandEventOccurrences, formatInTimeZone, type EventModel } from "@/lib/events"
import type { EventOccurrence } from "@/lib/events"
import { useToast } from "@/components/ui/use-toast"
import { EventCard } from "./event-card"

type ViewMode = "month" | "week" | "list"
type EventType = "general" | "voice" | "external"
type Recurrence = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly"

export interface EventAttendee {
  user_id: string
  status: string
  display_name: string | null
  avatar_url: string | null
}

export interface ServerEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string | null
  capacity: number | null
  cancelled_at: string | null
  voice_channel_id: string | null
  event_type: string | null
  external_url: string | null
  banner_url: string | null
  recurrence: string | null
  recurrence_until: string | null
  created_by: string
  attendees: EventAttendee[]
  myRsvp: { status: string } | null
  stats: { going: number; maybe: number; interested: number; waitlist: number; notGoing: number; [key: string]: number | undefined }
}

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
]

function toLocalDatetime(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  const h = String(date.getHours()).padStart(2, "0")
  const min = String(date.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${d}T${h}:${min}`
}

export function EventsCalendar({
  serverId,
  channels,
  canManageEvents = false,
  currentUserId,
}: {
  serverId: string
  channels: Array<{ id: string; name: string; type?: string }>
  canManageEvents?: boolean
  currentUserId: string
}) {
  const { toast } = useToast()
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [view, setView] = useState<ViewMode>("month")
  const [popover, setPopover] = useState<{ eventId: string; rect: DOMRect } | null>(null)
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [startAt, setStartAt] = useState("")
  const [endAt, setEndAt] = useState("")
  const [capacity, setCapacity] = useState("")
  const [linkedChannelId, setLinkedChannelId] = useState(channels[0]?.id ?? "")
  const [eventType, setEventType] = useState<EventType>("general")
  const [externalUrl, setExternalUrl] = useState("")
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [recurrence, setRecurrence] = useState<Recurrence>("none")
  const [recurrenceUntil, setRecurrenceUntil] = useState("")


  // Initialize date-dependent form defaults on mount to avoid hydration mismatch
  useEffect(() => {
    if (!startAt) setStartAt(toLocalDatetime(new Date(Date.now() + 24 * 60 * 60 * 1000)))
    if (!endAt) setEndAt(toLocalDatetime(new Date(Date.now() + 25 * 60 * 60 * 1000)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const res = await fetch(`/api/servers/${serverId}/events`, { cache: "no-store" })
    if (res.ok) setEvents(await res.json())
  }

  useEffect(() => { void load() }, [serverId])

  const [anchor, setAnchor] = useState(new Date())

  const range = useMemo(() => {
    if (view === "month") {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59)
      return { start, end }
    }
    if (view === "week") {
      const start = new Date(anchor)
      start.setDate(start.getDate() - start.getDay())
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      end.setHours(23, 59, 59)
      return { start, end }
    }
    const start = new Date()
    const end = new Date()
    end.setDate(end.getDate() + 90)
    return { start, end }
  }, [view, anchor])

  const occurrences = useMemo(
    () => expandEventOccurrences(events as unknown as EventModel[], range.start, range.end),
    [events, range]
  )

  function resetForm() {
    setTitle("")
    setDescription("")
    setLocation("")
    setStartAt(toLocalDatetime(new Date(Date.now() + 24 * 60 * 60 * 1000)))
    setEndAt(toLocalDatetime(new Date(Date.now() + 25 * 60 * 60 * 1000)))
    setCapacity("")
    setLinkedChannelId(channels[0]?.id ?? "")
    setEventType("general")
    setExternalUrl("")
    setBannerFile(null)
    setRecurrence("none")
    setRecurrenceUntil("")
    setShowForm(false)
  }

  async function uploadBanner(file: File): Promise<string | null> {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("serverId", serverId)
    const res = await fetch("/api/upload/event-banner", { method: "POST", body: formData })
    if (!res.ok) return null
    const json = await res.json()
    return json.url ?? null
  }

  async function createEvent() {
    if (!title.trim()) return
    const startDate = new Date(startAt)
    const endDate = new Date(endAt)
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      toast({ variant: "destructive", title: "Invalid date/time", description: "Please set both start and end times." })
      return
    }
    setCreating(true)
    try {
      let bannerUrl: string | null = null
      if (bannerFile) {
        setBannerUploading(true)
        bannerUrl = await uploadBanner(bannerFile)
        setBannerUploading(false)
      }

      const res = await fetch(`/api/servers/${serverId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          timezone,
          startAt: startDate.toISOString(),
          endAt: endDate.toISOString(),
          recurrence,
          recurrenceUntil: recurrence !== "none" && recurrenceUntil ? recurrenceUntil : undefined,
          capacity: capacity ? parseInt(capacity, 10) : undefined,
          linkedChannelId: linkedChannelId || undefined,
          eventType,
          externalUrl: eventType === "external" ? externalUrl : undefined,
          voiceChannelId: eventType === "voice" && linkedChannelId ? linkedChannelId : undefined,
          bannerUrl: bannerUrl ?? undefined,
          notifyMembers: true,
        }),
      })
      if (res.ok) {
        resetForm()
        await load()
      }
    } finally {
      setCreating(false)
      setBannerUploading(false)
    }
  }

  async function rsvp(eventId: string, status: "interested" | "going" | "maybe" | "not_going") {
    const prevEvents = events
    setEvents((prev) => prev.map((e) => {
      if (e.id !== eventId) return e
      const prevStatus: string | null = e.myRsvp?.status ?? null
      const newStats = { ...(e.stats ?? {}) }
      if (prevStatus && prevStatus !== status) {
        newStats[prevStatus] = Math.max(0, (newStats[prevStatus] ?? 0) - 1)
      }
      if (prevStatus !== status) {
        newStats[status] = (newStats[status] ?? 0) + 1
      }
      return { ...e, myRsvp: { ...(e.myRsvp ?? {}), status }, stats: newStats }
    }))
    try {
      const res = await fetch(`/api/servers/${serverId}/events/${eventId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) setEvents(prevEvents)
    } catch {
      setEvents(prevEvents)
    }
  }

  async function deleteEvent(eventId: string) {
    try {
      const res = await fetch(`/api/servers/${serverId}/events/${eventId}`, { method: "DELETE" })
      if (res.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== eventId))
        setPopover(null)
      } else {
        const data = await res.json().catch(() => null)
        toast({ variant: "destructive", title: "Failed to delete event", description: data?.error ?? "Something went wrong" })
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to delete event", description: "A network error occurred" })
    }
  }

  async function updateEvent(eventId: string, updates: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/servers/${serverId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        await load()
      } else {
        const data = await res.json().catch(() => null)
        toast({ variant: "destructive", title: "Failed to update event", description: data?.error ?? "Something went wrong" })
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to update event", description: "A network error occurred" })
    }
  }

  function canEditEvent(event: ServerEvent): boolean {
    return canManageEvents || event.created_by === currentUserId
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-zinc-100">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={view === "month" ? "default" : "secondary"} onClick={() => setView("month")}>Month</Button>
        <Button variant={view === "week" ? "default" : "secondary"} onClick={() => setView("week")}>Week</Button>
        <Button variant={view === "list" ? "default" : "secondary"} onClick={() => setView("list")}>List</Button>

        {view !== "list" && (
          <>
            <Button variant="ghost" size="sm" onClick={() => {
              setAnchor((a) => {
                const d = new Date(a)
                if (view === "month") d.setMonth(d.getMonth() - 1)
                else d.setDate(d.getDate() - 7)
                return d
              })
            }} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {view === "month"
                ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
                : `Week of ${range.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => {
              setAnchor((a) => {
                const d = new Date(a)
                if (view === "month") d.setMonth(d.getMonth() + 1)
                else d.setDate(d.getDate() + 7)
                return d
              })
            }} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <a className="text-sm underline text-zinc-400" href={`/api/servers/${serverId}/events/ical`}>Export iCal</a>
          {canManageEvents && !showForm && (
            <Button onClick={() => setShowForm(true)}>Create event</Button>
          )}
        </div>
      </div>

      {canManageEvents && showForm && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">New Event</h3>
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
          </div>

          {/* Event type */}
          <div className="space-y-1">
            <Label>Event Type</Label>
            <div className="flex gap-2">
              {(["general", "voice", "external"] as EventType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEventType(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium border transition-colors capitalize ${
                    eventType === t
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="event-title">Title</Label>
            <Input id="event-title" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="event-desc">Description</Label>
            <Input id="event-desc" placeholder="What's this event about?" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="event-location">Location (optional)</Label>
            <Input id="event-location" placeholder="Where is this event?" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="event-start">Start</Label>
              <Input id="event-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-end">End</Label>
              <Input id="event-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-zinc-400 self-center mr-1">Duration:</span>
            {[
              { label: "30m", mins: 30 },
              { label: "1h", mins: 60 },
              { label: "2h", mins: 120 },
              { label: "3h", mins: 180 },
              { label: "All day", mins: 1440 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  if (startAt) {
                    const s = new Date(startAt)
                    setEndAt(toLocalDatetime(new Date(s.getTime() + preset.mins * 60_000)))
                  }
                }}
                className="rounded px-2 py-0.5 text-xs border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="event-capacity">Capacity (optional)</Label>
              <Input id="event-capacity" type="number" min="1" placeholder="Unlimited" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-channel">Linked channel</Label>
              <select
                id="event-channel"
                value={linkedChannelId}
                onChange={(e) => setLinkedChannelId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-zinc-100"
              >
                <option value="">None</option>
                {channels
                  .filter((ch) => ch.type === "voice" || ch.type === "forum")
                  .map((ch) => (
                    <option key={ch.id} value={ch.id}>#{ch.name}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* Recurrence */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="event-recurrence">Repeat</Label>
              <select
                id="event-recurrence"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-zinc-100"
              >
                {RECURRENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {recurrence !== "none" && (
              <div className="space-y-1">
                <Label htmlFor="event-recurrence-until">Repeat until (optional)</Label>
                <Input
                  id="event-recurrence-until"
                  type="date"
                  value={recurrenceUntil}
                  onChange={(e) => setRecurrenceUntil(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* External URL field */}
          {eventType === "external" && (
            <div className="space-y-1">
              <Label htmlFor="event-external-url">Event URL</Label>
              <Input
                id="event-external-url"
                type="url"
                placeholder="https://..."
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
              />
            </div>
          )}


          {/* Banner upload */}
          <div className="space-y-1">
            <Label htmlFor="event-banner">Banner image (optional)</Label>
            <Input
              id="event-banner"
              type="file"
              accept="image/*"
              onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-xs file:text-zinc-200"
            />
            {bannerFile && (
              <p className="text-xs text-zinc-400">Selected: {bannerFile.name}</p>
            )}
          </div>

          <Button onClick={createEvent} disabled={creating || !title.trim()}>
            {bannerUploading ? "Uploading banner..." : creating ? "Creating..." : "Create event"}
          </Button>
        </div>
      )}

      {view === "month" && <MonthView occurrences={occurrences} events={events} anchor={anchor} timezone={timezone} rsvp={rsvp} onClickEvent={(eventId, rect) => setPopover(popover?.eventId === eventId ? null : { eventId, rect })} />}
      {view === "week" && <WeekView occurrences={occurrences} events={events} range={range} timezone={timezone} rsvp={rsvp} onClickEvent={(eventId, rect) => setPopover(popover?.eventId === eventId ? null : { eventId, rect })} />}
      {view === "list" && <ListView occurrences={occurrences} events={events} timezone={timezone} rsvp={rsvp} serverId={serverId} canEditEvent={canEditEvent} onDelete={deleteEvent} onCancel={(id) => updateEvent(id, { cancelled: true })} />}

      {popover && (() => {
        const popoverEvent = events.find((e) => e.id === popover.eventId)
        return (
          <EventPopover
            eventId={popover.eventId}
            anchorRect={popover.rect}
            occurrences={occurrences}
            events={events}
            timezone={timezone}
            rsvp={rsvp}
            onClose={() => setPopover(null)}
            canEdit={popoverEvent ? canEditEvent(popoverEvent) : false}
            onDelete={deleteEvent}
            onCancel={(id) => updateEvent(id, { cancelled: true })}
            serverId={serverId}
          />
        )
      })()}
    </div>
  )
}

// ── Shared types for sub-views ───────────────────────────────────────────────

type RsvpFn = (eventId: string, status: "interested" | "going" | "maybe" | "not_going") => Promise<void>

type ViewProps = {
  occurrences: EventOccurrence[]
  events: ServerEvent[]
  timezone: string
  rsvp: RsvpFn
  onClickEvent: (eventId: string, rect: DOMRect) => void
}

function formatTime12h(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
}

// ── Popover ──────────────────────────────────────────────────────────────────

const POPOVER_W = 340
const POPOVER_GAP = 8

function EventPopover({ eventId, anchorRect, occurrences, events, timezone, rsvp, onClose, canEdit, onDelete, onCancel, serverId }: {
  eventId: string
  anchorRect: DOMRect
  occurrences: EventOccurrence[]
  events: ServerEvent[]
  timezone: string
  rsvp: RsvpFn
  onClose: () => void
  canEdit?: boolean
  onDelete?: (eventId: string) => Promise<void>
  onCancel?: (eventId: string) => Promise<void>
  serverId: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const occ = occurrences.find((o) => o.eventId === eventId)
  const full = events.find((e) => e.id === eventId)

  useEffect(() => {
    function handler(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("pointerdown", handler)
    return () => document.removeEventListener("pointerdown", handler)
  }, [onClose])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  if (!occ || !full) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = anchorRect.right + POPOVER_GAP
  let top = anchorRect.top
  if (left + POPOVER_W > vw - POPOVER_GAP) left = anchorRect.left - POPOVER_W - POPOVER_GAP
  if (left < POPOVER_GAP) {
    left = Math.max(POPOVER_GAP, anchorRect.left + anchorRect.width / 2 - POPOVER_W / 2)
    top = anchorRect.bottom + POPOVER_GAP
  }
  top = Math.max(POPOVER_GAP, Math.min(top, vh - 300))

  const myStatus: string | null = full?.myRsvp?.status ?? null

  return createPortal(
    <div
      ref={ref}
      data-event-popover
      style={{ position: "fixed", top, left, width: POPOVER_W, zIndex: 50 }}
      className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl shadow-black/40 animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-zinc-100">{occ.title}</h3>
        <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200 shrink-0 mt-0.5" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {full.description && <p className="text-sm text-zinc-400 mt-1">{full.description}</p>}
      <div className="text-sm text-zinc-300 mt-2">
        {formatInTimeZone(occ.startAt.toISOString(), timezone)} &rarr; {formatInTimeZone(occ.endAt.toISOString(), timezone)}
      </div>
      {full.location && (
        <div className="text-sm text-zinc-400 mt-1">{full.location}</div>
      )}
      <div className="mt-1.5 text-xs text-zinc-400">
        Capacity: {full.capacity ?? "unlimited"} &middot; Going: {full.stats?.going ?? 0} &middot; Waitlist: {full.stats?.waitlist ?? 0}
      </div>
      {full.attendees?.length > 0 && (
        <div className="mt-2 flex items-center gap-1">
          <div className="flex -space-x-1.5">
            {full.attendees.slice(0, 5).map((a: EventAttendee) => (
              <div key={a.user_id} className="h-6 w-6 rounded-full border-2 border-zinc-900 bg-zinc-700 overflow-hidden" title={a.display_name ?? "User"}>
                {a.avatar_url ? (
                  <img src={a.avatar_url} alt={a.display_name ? `${a.display_name}'s avatar` : "Event attendee"} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-[10px] text-zinc-300">
                    {(a.display_name ?? "?")[0].toUpperCase()}
                  </div>
                )}
              </div>
            ))}
          </div>
          {full.attendees.length > 5 && (
            <span className="text-xs text-zinc-500">+{full.attendees.length - 5} more</span>
          )}
        </div>
      )}
      {myStatus === "waitlist" && (
        <div className="mt-1.5 text-xs text-yellow-400">You are on the waitlist</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={myStatus === "interested" ? "default" : "secondary"} onClick={() => rsvp(occ.eventId, "interested")}>
          {myStatus === "interested" ? "\u2713 Interested" : "Interested"}
        </Button>
        <Button size="sm" variant={myStatus === "going" ? "default" : "secondary"} onClick={() => rsvp(occ.eventId, "going")}>
          {myStatus === "going" ? "\u2713 Going" : "Going"}
        </Button>
        <Button size="sm" variant={myStatus === "maybe" ? "default" : "secondary"} onClick={() => rsvp(occ.eventId, "maybe")}>
          {myStatus === "maybe" ? "\u2713 Maybe" : "Maybe"}
        </Button>
        <Button size="sm" variant={myStatus === "not_going" ? "default" : "secondary"} onClick={() => rsvp(occ.eventId, "not_going")}>
          {myStatus === "not_going" ? "\u2713 Not going" : "Not going"}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-700/50 pt-2">
        {!full.cancelled_at && onCancel && canEdit && (
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => onCancel(occ.eventId)}>
            Cancel event
          </Button>
        )}
        {onDelete && canEdit && (
          <Button size="sm" variant="secondary" className="h-7 text-xs text-red-400 hover:text-red-300" onClick={() => {
            if (window.confirm("Are you sure you want to delete this event? This cannot be undone.")) {
              onDelete(occ.eventId)
            }
          }}>
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => window.open(`/api/servers/${serverId}/events/${occ.eventId}/ical`, "_blank")}
        >
          <Calendar className="mr-1 h-3 w-3" />
          Add to calendar
        </Button>
      </div>
    </div>,
    document.body
  )
}

function eventTypeColors(eventType: string | null | undefined): string {
  switch (eventType) {
    case "voice":
      return "bg-green-900/40 text-green-200 border-green-800/50 hover:bg-green-800/50"
    case "external":
      return "bg-purple-900/40 text-purple-200 border-purple-800/50 hover:bg-purple-800/50"
    default:
      return "bg-blue-900/40 text-blue-200 border-blue-800/50 hover:bg-blue-800/50"
  }
}

// ── Month view ───────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function MonthView({ occurrences, events, anchor, onClickEvent }: ViewProps & { anchor: Date }) {
  const today = new Date()
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: Array<{ day: number | null }> = []
  for (let i = 0; i < firstDay; i++) cells.push({ day: null })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d })

  function eventsForDay(day: number) {
    return occurrences.filter((occ) => {
      const d = occ.startAt
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })
  }

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 gap-px bg-zinc-800 rounded-lg overflow-hidden border border-zinc-700">
        {DAY_NAMES.map((name) => (
          <div key={name} className="bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-400 text-center">{name}</div>
        ))}
        {cells.map((cell, i) => {
          const dayEvents = cell.day ? eventsForDay(cell.day) : []
          return (
            <div key={i} className={`bg-zinc-950 min-h-[100px] p-1.5 ${cell.day ? "" : "opacity-30"}`}>
              {cell.day && (
                <>
                  <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday(cell.day) ? "bg-blue-600 text-white" : "text-zinc-400"}`}>
                    {cell.day}
                  </div>
                  {dayEvents.map((occ) => {
                    const ev = events.find((e) => e.id === occ.eventId)
                    return (
                      <button
                        key={`${occ.eventId}-${occ.startAt.toISOString()}`}
                        type="button"
                        onClick={(e) => onClickEvent(occ.eventId, (e.currentTarget as HTMLElement).getBoundingClientRect())}
                        className={`text-xs w-full text-left rounded px-1.5 py-0.5 mb-0.5 truncate border cursor-pointer transition-colors ${eventTypeColors(ev?.event_type)}`}
                      >
                        {occ.title}
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Week view ────────────────────────────────────────────────────────────────

function WeekView({ occurrences, events, range, onClickEvent }: ViewProps & { range: { start: Date; end: Date } }) {
  const today = new Date()
  const days: Date[] = []
  const d = new Date(range.start)
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }

  function eventsForDay(day: Date) {
    return occurrences.filter((occ) =>
      occ.startAt.getFullYear() === day.getFullYear() &&
      occ.startAt.getMonth() === day.getMonth() &&
      occ.startAt.getDate() === day.getDate()
    )
  }

  const isToday = (day: Date) =>
    day.getDate() === today.getDate() && day.getMonth() === today.getMonth() && day.getFullYear() === today.getFullYear()

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 gap-px bg-zinc-800 rounded-lg overflow-hidden border border-zinc-700">
        {days.map((day) => (
          <div key={day.toISOString()} className="bg-zinc-900 px-2 py-1.5 text-center">
            <div className="text-xs text-zinc-400">{DAY_NAMES[day.getDay()]}</div>
            <div className={`text-sm font-medium mt-0.5 w-7 h-7 flex items-center justify-center rounded-full mx-auto ${isToday(day) ? "bg-blue-600 text-white" : "text-zinc-200"}`}>
              {day.getDate()}
            </div>
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = eventsForDay(day)
          return (
            <div key={`body-${day.toISOString()}`} className="bg-zinc-950 min-h-[200px] p-1.5">
              {dayEvents.map((occ) => {
                const full = events.find((e) => e.id === occ.eventId)
                return (
                  <button
                    key={`${occ.eventId}-${occ.startAt.toISOString()}`}
                    type="button"
                    onClick={(e) => onClickEvent(occ.eventId, (e.currentTarget as HTMLElement).getBoundingClientRect())}
                    className={`text-xs w-full text-left rounded p-1.5 mb-1 border cursor-pointer transition-colors ${eventTypeColors(full?.event_type)}`}
                  >
                    <div className="font-medium truncate">{occ.title}</div>
                    <div className="opacity-70 mt-0.5">{formatTime12h(occ.startAt)}</div>
                    {full && <div className="opacity-50 mt-0.5">{full.stats?.going ?? 0} going</div>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── List view ────────────────────────────────────────────────────────────────

function ListView({ occurrences, events, timezone, rsvp, serverId, canEditEvent, onDelete, onCancel }: Omit<ViewProps, "onClickEvent"> & { serverId: string; canEditEvent: (event: ServerEvent) => boolean; onDelete: (eventId: string) => Promise<void>; onCancel: (eventId: string) => Promise<void> }) {
  const grouped = useMemo(() => {
    const map = new Map<string, EventOccurrence[]>()
    for (const occ of occurrences) {
      const key = occ.startAt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(occ)
    }
    return Array.from(map.entries())
  }, [occurrences])

  if (occurrences.length === 0) {
    return <div className="text-center text-zinc-500 py-8">No upcoming events</div>
  }

  return (
    <div className="flex-1 overflow-auto space-y-6">
      {grouped.map(([dateLabel, dayOccurrences]) => (
        <div key={dateLabel}>
          <div className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">{dateLabel}</div>
          <div className="grid gap-3">
            {dayOccurrences.map((occ) => {
              const full = events.find((e) => e.id === occ.eventId)
              if (!full) return null
              return (
                <EventCard
                  key={`${occ.eventId}-${occ.startAt.toISOString()}`}
                  event={full}
                  occurrence={occ}
                  timezone={timezone}
                  serverId={serverId}
                  onRsvp={rsvp}
                  canEdit={canEditEvent(full)}
                  onDelete={onDelete}
                  onCancel={onCancel}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
