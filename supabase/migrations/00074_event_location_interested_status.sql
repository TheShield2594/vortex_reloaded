-- Add location field to events
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN public.events.location IS 'Physical or virtual location/address for the event';

-- Add "interested" to event_rsvps status options
ALTER TABLE public.event_rsvps DROP CONSTRAINT IF EXISTS event_rsvps_status_check;
ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_status_check
  CHECK (status IN ('interested', 'going', 'maybe', 'not_going', 'waitlist'));
