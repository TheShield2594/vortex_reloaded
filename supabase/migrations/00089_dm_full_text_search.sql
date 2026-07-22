-- Migration: Add full-text search vector to direct_messages table
-- Enables server-side FTS for DMs, matching the existing messages.search_vector pattern

-- 1. Add tsvector column
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create GIN index for fast full-text queries
CREATE INDEX IF NOT EXISTS direct_messages_fts_idx
  ON public.direct_messages USING gin (search_vector);

-- 3. Create trigger function to auto-update search_vector on insert/update
CREATE OR REPLACE FUNCTION public.direct_messages_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$;

-- 4. Attach trigger
DROP TRIGGER IF EXISTS direct_messages_search_vector_trigger ON public.direct_messages;
CREATE TRIGGER direct_messages_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.direct_messages_search_vector_update();

-- 5. Backfill existing rows
UPDATE public.direct_messages
SET search_vector = to_tsvector('english', COALESCE(content, ''))
WHERE search_vector IS NULL;
