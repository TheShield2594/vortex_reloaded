-- Events, RSVP, reminders

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  linked_channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  recurrence_until TIMESTAMPTZ,
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  create_voice_channel BOOLEAN NOT NULL DEFAULT FALSE,
  voice_channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  post_event_thread BOOLEAN NOT NULL DEFAULT FALSE,
  thread_id UUID REFERENCES public.threads(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS public.event_hosts (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'not_going', 'waitlist')),
  waitlist_position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.event_reminders (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  minutes_before INTEGER NOT NULL CHECK (minutes_before IN (10, 60, 1440)),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id, minutes_before)
);

CREATE INDEX IF NOT EXISTS events_server_start_idx ON public.events(server_id, start_at);
CREATE INDEX IF NOT EXISTS event_rsvps_event_status_idx ON public.event_rsvps(event_id, status);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER event_rsvps_updated_at
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view events"
  ON public.events FOR SELECT
  USING (public.is_server_member(server_id));

CREATE POLICY "Members with MANAGE_EVENTS can create events"
  ON public.events FOR INSERT
  WITH CHECK (public.has_permission(server_id, 8192));

CREATE POLICY "Members with MANAGE_EVENTS can update events"
  ON public.events FOR UPDATE
  USING (public.has_permission(server_id, 8192));

CREATE POLICY "Members with MANAGE_EVENTS can delete events"
  ON public.events FOR DELETE
  USING (public.has_permission(server_id, 8192));

CREATE POLICY "Members can view event hosts"
  ON public.event_hosts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_hosts.event_id
        AND public.is_server_member(e.server_id)
    )
  );

CREATE POLICY "Event managers can manage event hosts"
  ON public.event_hosts FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_hosts.event_id
        AND public.has_permission(e.server_id, 8192)
    )
  );

CREATE POLICY "Members can view event RSVPs"
  ON public.event_rsvps FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_rsvps.event_id
        AND public.is_server_member(e.server_id)
    )
  );

CREATE POLICY "Members can RSVP for themselves"
  ON public.event_rsvps FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_rsvps.event_id
        AND public.is_server_member(e.server_id)
    )
  );

CREATE POLICY "Members can update own RSVP"
  ON public.event_rsvps FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Members can delete own RSVP"
  ON public.event_rsvps FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own reminders"
  ON public.event_reminders FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own reminders"
  ON public.event_reminders FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
