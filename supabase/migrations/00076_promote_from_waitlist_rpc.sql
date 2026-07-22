-- Atomic waitlist promotion: promotes the next waitlisted candidate for an
-- event in a single transaction with row-level locking on the parent event
-- to serialize concurrent promotions.
CREATE OR REPLACE FUNCTION public.promote_from_waitlist(
  p_event_id UUID,
  p_event_capacity INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_capacity INTEGER;
  v_going_count INTEGER;
  v_promoted_user_id UUID;
BEGIN
  -- Lock the parent event row and read authoritative capacity
  SELECT capacity INTO v_event_capacity
  FROM public.events WHERE id = p_event_id FOR UPDATE;

  -- If event has no capacity limit, nothing to promote into
  IF v_event_capacity IS NULL THEN
    RETURN NULL;
  END IF;

  -- Count current "going" RSVPs (no FOR UPDATE needed — event lock serializes)
  SELECT COUNT(*)
  INTO v_going_count
  FROM public.event_rsvps
  WHERE event_id = p_event_id AND status = 'going';

  -- Only promote if there's room
  IF v_going_count >= v_event_capacity THEN
    RETURN NULL;
  END IF;

  -- Find and lock the next waitlist candidate
  SELECT user_id
  INTO v_promoted_user_id
  FROM public.event_rsvps
  WHERE event_id = p_event_id AND status = 'waitlist'
  ORDER BY
    waitlist_position ASC NULLS LAST,
    created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_promoted_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Promote to going
  UPDATE public.event_rsvps
  SET status = 'going', waitlist_position = NULL
  WHERE event_id = p_event_id AND user_id = v_promoted_user_id;

  RETURN v_promoted_user_id;
END;
$$;

-- Restrict execution to service_role only (SECURITY DEFINER function)
REVOKE EXECUTE ON FUNCTION public.promote_from_waitlist(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_from_waitlist(UUID, INTEGER) TO service_role;

-- Atomically update event capacity and promote waitlisted users to fill
-- newly opened slots, all under the same event row lock.
CREATE OR REPLACE FUNCTION public.set_event_capacity_and_promote(
  p_event_id UUID,
  p_server_id UUID,
  p_new_capacity INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_going_count INTEGER;
  v_promoted INTEGER := 0;
  v_candidate_user_id UUID;
BEGIN
  -- Lock the event row and update capacity atomically
  UPDATE public.events
  SET capacity = p_new_capacity
  WHERE id = p_event_id AND server_id = p_server_id;

  -- Count current "going" RSVPs
  SELECT COUNT(*)
  INTO v_going_count
  FROM public.event_rsvps
  WHERE event_id = p_event_id AND status = 'going';

  -- Promote waitlisted users until full or waitlist exhausted
  WHILE v_going_count < p_new_capacity LOOP
    SELECT user_id
    INTO v_candidate_user_id
    FROM public.event_rsvps
    WHERE event_id = p_event_id AND status = 'waitlist'
    ORDER BY
      waitlist_position ASC NULLS LAST,
      created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN v_candidate_user_id IS NULL;

    UPDATE public.event_rsvps
    SET status = 'going', waitlist_position = NULL
    WHERE event_id = p_event_id AND user_id = v_candidate_user_id;

    v_going_count := v_going_count + 1;
    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN v_promoted;
END;
$$;

-- Restrict execution to service_role only
REVOKE EXECUTE ON FUNCTION public.set_event_capacity_and_promote(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_event_capacity_and_promote(UUID, UUID, INTEGER) TO service_role;

-- Partial index for fast waitlist candidate lookup ordered by position/created_at
CREATE INDEX IF NOT EXISTS event_rsvps_waitlist_order_idx
  ON public.event_rsvps (event_id, waitlist_position, created_at)
  WHERE status = 'waitlist';
