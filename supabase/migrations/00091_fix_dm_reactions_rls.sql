-- ============================================================
-- Fix DM reactions RLS — use SECURITY DEFINER helper
-- ============================================================
-- The original INSERT and SELECT policies on dm_reactions used inline
-- EXISTS subqueries that JOIN direct_messages + dm_channel_members.
-- Because both referenced tables have their own RLS policies, nested
-- policy evaluation can fail or produce false negatives.
--
-- Fix: create a SECURITY DEFINER helper (like is_dm_channel_member)
-- that bypasses RLS for the inner lookup, then rewrite the policies
-- to use it.
-- ============================================================

-- Helper: check if the current user is a member of the DM channel
-- that contains the given direct message.
CREATE OR REPLACE FUNCTION public.is_dm_message_participant(p_dm_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_messages dm
    JOIN public.dm_channel_members dcm ON dcm.dm_channel_id = dm.dm_channel_id
    WHERE dm.id = p_dm_id
      AND dcm.user_id = auth.uid()
  );
$$;

-- Replace SELECT policy
DROP POLICY IF EXISTS "DM channel members can view reactions" ON public.dm_reactions;
CREATE POLICY "DM channel members can view reactions"
  ON public.dm_reactions FOR SELECT
  USING (public.is_dm_message_participant(dm_id));

-- Replace INSERT policy
DROP POLICY IF EXISTS "DM channel members can add reactions" ON public.dm_reactions;
CREATE POLICY "DM channel members can add reactions"
  ON public.dm_reactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_dm_message_participant(dm_id)
  );
