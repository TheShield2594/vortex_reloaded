-- Atomic channel reorder: accepts a JSON array of {id, position, parent_id}
-- and updates all rows in a single transaction. This avoids N individual
-- updates that each trigger a realtime event, replacing them with one
-- atomic operation.
CREATE OR REPLACE FUNCTION public.reorder_channels(
  p_server_id UUID,
  p_updates JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE public.channels
    SET
      position = (item->>'position')::int,
      parent_id = CASE
        WHEN item->>'parent_id' IS NULL OR item->>'parent_id' = 'null' THEN NULL
        ELSE (item->>'parent_id')::uuid
      END
    WHERE id = (item->>'id')::uuid
      AND server_id = p_server_id;
  END LOOP;
END;
$$;
