-- ============================================================
-- DM Channels (unified 1:1 and group DMs)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dm_channels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,                    -- NULL for 1:1 (derived from partner name in UI)
  icon_url    TEXT,
  owner_id    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  is_group    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- bumped on every new message for sorting
);

CREATE INDEX IF NOT EXISTS dm_channels_updated_idx ON public.dm_channels(updated_at DESC);

-- ============================================================
-- DM Channel Members
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dm_channel_members (
  dm_channel_id UUID NOT NULL REFERENCES public.dm_channels(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dm_channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS dm_channel_members_user_idx ON public.dm_channel_members(user_id);

-- ============================================================
-- Migrate existing direct_messages → dm_channels
-- Add dm_channel_id column
-- ============================================================
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS dm_channel_id UUID REFERENCES public.dm_channels(id) ON DELETE CASCADE;

-- Allow receiver_id to be NULL for new group DM messages (which use dm_channel_id instead)
ALTER TABLE public.direct_messages ALTER COLUMN receiver_id DROP NOT NULL;

-- Create a dm_channel for every unique 1:1 pair that has messages
DO $$
DECLARE
  pair RECORD;
  chan_id UUID;
BEGIN
  FOR pair IN
    SELECT DISTINCT
      LEAST(sender_id, receiver_id) AS user_a,
      GREATEST(sender_id, receiver_id) AS user_b
    FROM public.direct_messages
    WHERE dm_channel_id IS NULL
      AND receiver_id IS NOT NULL
  LOOP
    -- Create channel
    INSERT INTO public.dm_channels (is_group, owner_id)
    VALUES (FALSE, pair.user_a)
    RETURNING id INTO chan_id;

    -- Add both members
    INSERT INTO public.dm_channel_members (dm_channel_id, user_id)
    VALUES (chan_id, pair.user_a), (chan_id, pair.user_b)
    ON CONFLICT DO NOTHING;

    -- Link messages
    UPDATE public.direct_messages
    SET dm_channel_id = chan_id
    WHERE dm_channel_id IS NULL
      AND (
        (sender_id = pair.user_a AND receiver_id = pair.user_b)
        OR (sender_id = pair.user_b AND receiver_id = pair.user_a)
      );
  END LOOP;
END $$;

-- Bump dm_channels.updated_at to latest message time for sorting
UPDATE public.dm_channels dc
SET updated_at = (
  SELECT MAX(created_at) FROM public.direct_messages dm
  WHERE dm.dm_channel_id = dc.id
)
WHERE EXISTS (
  SELECT 1 FROM public.direct_messages dm WHERE dm.dm_channel_id = dc.id
);

-- Trigger: bump dm_channel.updated_at on new message
CREATE OR REPLACE FUNCTION public.dm_message_bump_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dm_channel_id IS NOT NULL THEN
    UPDATE public.dm_channels SET updated_at = NOW() WHERE id = NEW.dm_channel_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dm_message_bump_trigger ON public.direct_messages;
CREATE TRIGGER dm_message_bump_trigger
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.dm_message_bump_updated();

-- ============================================================
-- DM Read States (unread tracking per DM channel)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dm_read_states (
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dm_channel_id UUID NOT NULL REFERENCES public.dm_channels(id) ON DELETE CASCADE,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dm_channel_id)
);

-- ============================================================
-- Push Notification Subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint    TEXT        NOT NULL,
  p256dh      TEXT        NOT NULL,
  auth        TEXT        NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can manage own push subscriptions"
  ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid());

-- ============================================================
-- RLS for new tables
-- ============================================================
ALTER TABLE public.dm_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_read_states ENABLE ROW LEVEL SECURITY;

-- Users can see dm_channels they are members of
CREATE POLICY "dm members can view channels"
  ON public.dm_channels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dm_channel_members m
      WHERE m.dm_channel_id = id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "dm members can update channels"
  ON public.dm_channels FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "anyone can create dm channels"
  ON public.dm_channels FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Members
CREATE POLICY "dm members can view membership"
  ON public.dm_channel_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dm_channel_members m2
      WHERE m2.dm_channel_id = dm_channel_id AND m2.user_id = auth.uid()
    )
  );

CREATE POLICY "channel owner can add members"
  ON public.dm_channel_members FOR INSERT
  WITH CHECK (added_by = auth.uid());

CREATE POLICY "members can leave"
  ON public.dm_channel_members FOR DELETE
  USING (user_id = auth.uid());

-- Read states
CREATE POLICY "users can manage own dm read states"
  ON public.dm_read_states FOR ALL
  USING (user_id = auth.uid());

-- Function to mark a DM channel as read
CREATE OR REPLACE FUNCTION public.mark_dm_read(p_dm_channel_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.dm_read_states (user_id, dm_channel_id, last_read_at)
  VALUES (auth.uid(), p_dm_channel_id, NOW())
  ON CONFLICT (user_id, dm_channel_id)
  DO UPDATE SET last_read_at = NOW();
END;
$$;
