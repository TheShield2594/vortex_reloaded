-- Migration: Discord-style threads as first-class entities
-- Creates the threads, thread_members, and thread_read_states tables with
-- full RLS policies and Realtime publication.
--
-- Depends on: 00014_channel_types.sql  (channels schema)
--             00014c_moderation.sql     (set_updated_at trigger function)

-- ── threads ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.threads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_channel_id     UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  starter_message_id    UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  owner_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  archived              BOOLEAN NOT NULL DEFAULT FALSE,
  locked                BOOLEAN NOT NULL DEFAULT FALSE,
  auto_archive_duration INTEGER NOT NULL DEFAULT 1440,
  archived_at           TIMESTAMPTZ,
  message_count         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_parent_channel_id ON public.threads(parent_channel_id);
CREATE INDEX IF NOT EXISTS idx_threads_owner_id          ON public.threads(owner_id);
CREATE INDEX IF NOT EXISTS idx_threads_archived          ON public.threads(parent_channel_id, archived);

-- Link messages back to their thread
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES public.threads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON public.messages(thread_id);

-- ── thread_members ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.thread_members (
  thread_id   UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_members_user_id ON public.thread_members(user_id);

-- ── thread_read_states ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.thread_read_states (
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_id    UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mention_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_read_states_user ON public.thread_read_states(user_id);

-- ── Triggers ──────────────────────────────────────────────────────────────────
CREATE TRIGGER threads_updated_at
  BEFORE UPDATE ON public.threads
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Increment message_count whenever a message is posted in a thread
CREATE OR REPLACE FUNCTION public.handle_thread_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.thread_id IS NOT NULL THEN
    UPDATE public.threads
    SET message_count = message_count + 1,
        updated_at    = NOW()
    WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_thread_message_inserted
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_thread_message();

-- ── Helper functions ──────────────────────────────────────────────────────────

-- Mark a thread as fully read for the calling user
CREATE OR REPLACE FUNCTION public.mark_thread_read(p_thread_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.thread_read_states (user_id, thread_id, last_read_at, mention_count)
  VALUES (auth.uid(), p_thread_id, NOW(), 0)
  ON CONFLICT (user_id, thread_id) DO UPDATE
    SET last_read_at  = NOW(),
        mention_count = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a thread rooted at an existing message
CREATE OR REPLACE FUNCTION public.create_thread_from_message(
  p_message_id UUID,
  p_name       TEXT
)
RETURNS public.threads AS $$
DECLARE
  v_msg    public.messages%ROWTYPE;
  v_thread public.threads%ROWTYPE;
BEGIN
  SELECT * INTO v_msg FROM public.messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  INSERT INTO public.threads (parent_channel_id, starter_message_id, owner_id, name)
  VALUES (v_msg.channel_id, p_message_id, auth.uid(), p_name)
  RETURNING * INTO v_thread;

  INSERT INTO public.thread_members (thread_id, user_id)
  VALUES (v_thread.id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN v_thread;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.threads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_read_states ENABLE ROW LEVEL SECURITY;

-- threads
CREATE POLICY "threads_select" ON public.threads
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.channels c
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE c.id = public.threads.parent_channel_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "threads_insert" ON public.threads
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.channels c
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE c.id = parent_channel_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "threads_update" ON public.threads
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.channels c
      WHERE c.id = public.threads.parent_channel_id
        AND public.is_server_owner(c.server_id)
    )
  );

CREATE POLICY "threads_delete" ON public.threads
  FOR DELETE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.channels c
      WHERE c.id = public.threads.parent_channel_id
        AND public.is_server_owner(c.server_id)
    )
  );

-- thread_members
CREATE POLICY "thread_members_select" ON public.thread_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.threads t
      JOIN public.channels c ON c.id = t.parent_channel_id
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE t.id = public.thread_members.thread_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "thread_members_insert" ON public.thread_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.threads t
      JOIN public.channels c ON c.id = t.parent_channel_id
      JOIN public.server_members sm ON sm.server_id = c.server_id
      WHERE t.id = thread_id
        AND sm.user_id = auth.uid()
        AND t.locked = FALSE
    )
  );

CREATE POLICY "thread_members_delete" ON public.thread_members
  FOR DELETE USING (user_id = auth.uid());

-- thread_read_states
CREATE POLICY "thread_read_states_select" ON public.thread_read_states
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "thread_read_states_insert" ON public.thread_read_states
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "thread_read_states_update" ON public.thread_read_states
  FOR UPDATE USING (user_id = auth.uid());

-- ── Realtime ──────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.thread_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.thread_read_states;
