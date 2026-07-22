-- Additional hardening fixes for migration 00041
-- Addresses: trigger dm_channel_id coverage, REVOKE EXECUTE on login functions

-- ============================================================
-- 1. DM reply trigger: also fire on dm_channel_id changes
-- ============================================================

DROP TRIGGER IF EXISTS trg_dm_reply_same_channel ON public.direct_messages;

CREATE TRIGGER trg_dm_reply_same_channel
  BEFORE INSERT OR UPDATE OF reply_to_id, dm_channel_id ON public.direct_messages
  FOR EACH ROW
  WHEN (NEW.reply_to_id IS NOT NULL)
  EXECUTE FUNCTION public.check_dm_reply_same_channel();


-- ============================================================
-- 2. Restrict SECURITY DEFINER login functions to service_role
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.is_login_locked_out(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_login_locked_out(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_login_attempt(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.clear_login_attempts(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_login_attempts(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_login_attempts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_login_attempts() TO service_role;


-- ============================================================
-- ROLLBACK:
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.cleanup_old_login_attempts() TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.clear_login_attempts(TEXT) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.record_login_attempt(TEXT, TEXT) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.is_login_locked_out(TEXT) TO PUBLIC;
-- DROP TRIGGER IF EXISTS trg_dm_reply_same_channel ON public.direct_messages;
-- CREATE TRIGGER trg_dm_reply_same_channel
--   BEFORE INSERT OR UPDATE OF reply_to_id ON public.direct_messages
--   FOR EACH ROW
--   WHEN (NEW.reply_to_id IS NOT NULL)
--   EXECUTE FUNCTION public.check_dm_reply_same_channel();
