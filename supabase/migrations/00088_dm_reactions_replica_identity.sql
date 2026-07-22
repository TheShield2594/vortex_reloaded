-- Set REPLICA IDENTITY FULL on dm_reactions so Supabase Realtime DELETE
-- events include the complete old row (dm_id, user_id, emoji, created_at).
-- Without this, DELETE events only include the primary key columns, which
-- can cause issues when the realtime handler needs to match and filter
-- the removed reaction from the local state.
ALTER TABLE public.dm_reactions REPLICA IDENTITY FULL;
