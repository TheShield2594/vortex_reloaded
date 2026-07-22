-- Migration: Thread auto-archive (Discord-style)
-- Adds an RPC function that archives threads whose last activity
-- exceeds their auto_archive_duration.  Called by an external cron
-- (Vercel cron / pg_cron / etc.) on a regular schedule.
--
-- Discord duration options: 60 (1h), 1440 (24h), 4320 (3d), 10080 (1w)

-- ── auto_archive_inactive_threads ────────────────────────────────────────────
-- Returns the number of threads that were archived.
CREATE OR REPLACE FUNCTION public.auto_archive_inactive_threads()
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  WITH to_archive AS (
    UPDATE public.threads
    SET archived    = TRUE,
        archived_at = NOW()
    WHERE archived = FALSE
      AND locked   = FALSE
      AND updated_at < NOW() - (auto_archive_duration || ' minutes')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO archived_count FROM to_archive;

  RETURN archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated role (the cron API route runs as an
-- authenticated service-role client).
GRANT EXECUTE ON FUNCTION public.auto_archive_inactive_threads() TO service_role;

-- ── Override create_thread_from_message to accept auto_archive_duration ──────
-- Drop the old two-argument overload to prevent ambiguous-call runtime errors.
DROP FUNCTION IF EXISTS public.create_thread_from_message(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_thread_from_message(
  p_message_id           UUID,
  p_name                 TEXT,
  p_auto_archive_duration INTEGER DEFAULT 1440
)
RETURNS public.threads AS $$
DECLARE
  v_msg    public.messages%ROWTYPE;
  v_thread public.threads%ROWTYPE;
BEGIN
  SELECT * INTO v_msg FROM public.messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  INSERT INTO public.threads (parent_channel_id, starter_message_id, owner_id, name, auto_archive_duration)
  VALUES (v_msg.channel_id, p_message_id, auth.uid(), p_name, p_auto_archive_duration)
  RETURNING * INTO v_thread;

  INSERT INTO public.thread_members (thread_id, user_id)
  VALUES (v_thread.id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN v_thread;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
