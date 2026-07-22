-- ============================================================
-- DM REACTIONS
-- ============================================================
-- Reactions on direct messages, mirroring the structure of the
-- channel-message reactions table but referencing direct_messages.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dm_reactions (
  dm_id UUID NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dm_id, user_id, emoji)
);

-- Enable realtime for dm_reactions
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_reactions;

-- RLS
ALTER TABLE public.dm_reactions ENABLE ROW LEVEL SECURITY;

-- Members of the DM channel can view reactions on messages in that channel
CREATE POLICY "DM channel members can view reactions"
  ON public.dm_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      JOIN public.dm_channel_members dcm ON dcm.dm_channel_id = dm.dm_channel_id
      WHERE dm.id = dm_reactions.dm_id
        AND dcm.user_id = auth.uid()
    )
  );

-- Members of the DM channel can add reactions
CREATE POLICY "DM channel members can add reactions"
  ON public.dm_reactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      JOIN public.dm_channel_members dcm ON dcm.dm_channel_id = dm.dm_channel_id
      WHERE dm.id = dm_reactions.dm_id
        AND dcm.user_id = auth.uid()
    )
  );

-- Users can remove their own reactions
CREATE POLICY "Users can remove own DM reactions"
  ON public.dm_reactions FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookup by dm_id
CREATE INDEX IF NOT EXISTS idx_dm_reactions_dm_id ON public.dm_reactions (dm_id);
