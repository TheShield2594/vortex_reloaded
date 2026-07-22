-- ============================================================
-- Fix recursive RLS policy on dm_channel_members
-- The original "dm members can view membership" policy referenced
-- dm_channel_members within its own USING clause, causing infinite
-- recursion in PostgreSQL. Replace it with a SECURITY DEFINER
-- function that bypasses RLS for the inner lookup.
-- ============================================================

-- Helper function: check if the current user is a member of a DM channel
-- SECURITY DEFINER bypasses RLS so there is no recursive policy evaluation.
CREATE OR REPLACE FUNCTION public.is_dm_channel_member(p_channel_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dm_channel_members
    WHERE dm_channel_id = p_channel_id AND user_id = auth.uid()
  );
$$;

-- Drop the recursive policy and replace it
DROP POLICY IF EXISTS "dm members can view membership" ON public.dm_channel_members;

CREATE POLICY "dm members can view membership"
  ON public.dm_channel_members FOR SELECT
  USING (public.is_dm_channel_member(dm_channel_id));

-- Also fix the direct_messages SELECT policy to cover group DM messages
-- (messages where receiver_id IS NULL but dm_channel_id belongs to a channel the user is in)
DROP POLICY IF EXISTS "Users can view their DMs" ON public.direct_messages;

CREATE POLICY "Users can view their DMs"
  ON public.direct_messages FOR SELECT
  USING (
    sender_id = auth.uid()
    OR receiver_id = auth.uid()
    OR (dm_channel_id IS NOT NULL AND public.is_dm_channel_member(dm_channel_id))
  );
