-- Fix: Allow dm_channels owner to view their own channel rows.
-- The existing SELECT policy only checks dm_channel_members, which doesn't
-- exist yet at INSERT time when .select() is chained after .insert().

CREATE POLICY "dm channel owner can view own channels"
  ON public.dm_channels FOR SELECT
  USING (owner_id = auth.uid());

-- Rollback:
-- DROP POLICY IF EXISTS "dm channel owner can view own channels" ON public.dm_channels;
