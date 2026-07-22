-- Migration: Denormalize server_id onto threads table (#657)
--
-- The threads RLS policy currently requires joining through channels → server_members
-- for every thread access. Adding server_id directly to threads eliminates ~50% of
-- those joins and lets us simplify the RLS policies.

-- 1. Add the column (nullable first so we can backfill)
ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS server_id UUID REFERENCES public.servers(id) ON DELETE CASCADE;

-- 2. Backfill from the parent channel
UPDATE public.threads t
SET server_id = c.server_id
FROM public.channels c
WHERE t.parent_channel_id = c.id
  AND t.server_id IS NULL;

-- 3. Make it NOT NULL now that all rows are populated
ALTER TABLE public.threads
  ALTER COLUMN server_id SET NOT NULL;

-- 4. Create an index for the new column
CREATE INDEX IF NOT EXISTS idx_threads_server_id ON public.threads(server_id);

-- 5. Trigger to auto-populate server_id on INSERT from parent channel
CREATE OR REPLACE FUNCTION public.handle_thread_server_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.server_id IS NULL THEN
    SELECT c.server_id INTO NEW.server_id
    FROM public.channels c
    WHERE c.id = NEW.parent_channel_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_thread_server_id
  BEFORE INSERT ON public.threads
  FOR EACH ROW EXECUTE FUNCTION public.handle_thread_server_id();

-- 6. Simplified RLS policies using threads.server_id directly

-- Drop old policies
DROP POLICY IF EXISTS "threads_select" ON public.threads;
DROP POLICY IF EXISTS "threads_insert" ON public.threads;
DROP POLICY IF EXISTS "threads_update" ON public.threads;
DROP POLICY IF EXISTS "threads_delete" ON public.threads;
DROP POLICY IF EXISTS "thread_members_select" ON public.thread_members;
DROP POLICY IF EXISTS "thread_members_insert" ON public.thread_members;

-- Recreate with direct server_id reference (no channel join needed for membership check)
CREATE POLICY "threads_select" ON public.threads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.server_members sm
      WHERE sm.server_id = threads.server_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "threads_insert" ON public.threads
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.server_members sm
      WHERE sm.server_id = server_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "threads_update" ON public.threads
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.servers s
      WHERE s.id = threads.server_id
        AND s.owner_id = auth.uid()
    )
  );

CREATE POLICY "threads_delete" ON public.threads
  FOR DELETE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.servers s
      WHERE s.id = threads.server_id
        AND s.owner_id = auth.uid()
    )
  );

-- thread_members: use threads.server_id instead of joining channels
CREATE POLICY "thread_members_select" ON public.thread_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.threads t
      JOIN public.server_members sm ON sm.server_id = t.server_id
      WHERE t.id = thread_members.thread_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "thread_members_insert" ON public.thread_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.threads t
      JOIN public.server_members sm ON sm.server_id = t.server_id
      WHERE t.id = thread_id
        AND sm.user_id = auth.uid()
        AND t.locked = FALSE
    )
  );
