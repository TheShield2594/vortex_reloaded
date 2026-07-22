-- Corrective migration: hardening fixes for policies, functions, indexes, and constraints
-- Addresses issues found during the code-quality audit (2026-02-26)

-- ============================================================
-- 1. recovery_codes: replace overly broad FOR ALL policy
-- ============================================================

DROP POLICY IF EXISTS "Users can manage own recovery codes" ON public.recovery_codes;
DROP POLICY IF EXISTS "Users can delete own recovery codes" ON public.recovery_codes;

-- Separate SELECT already exists; add targeted DELETE (insert via service role)
CREATE POLICY "Users can delete own recovery codes"
  ON public.recovery_codes FOR DELETE
  USING (user_id = auth.uid());


-- ============================================================
-- 2. login_attempts: add SET search_path to SECURITY DEFINER
--    functions and add ip_address index
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_login_locked_out(target_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  attempt_count INT;
BEGIN
  SELECT COUNT(*) INTO attempt_count
  FROM public.login_attempts
  WHERE email = LOWER(target_email)
    AND attempted_at > NOW() - INTERVAL '15 minutes';
  RETURN attempt_count >= 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.record_login_attempt(target_email TEXT, target_ip TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.login_attempts (email, ip_address)
  VALUES (LOWER(target_email), target_ip);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.clear_login_attempts(target_email TEXT)
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.login_attempts
  WHERE email = LOWER(target_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.cleanup_old_login_attempts()
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.login_attempts
  WHERE attempted_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON public.login_attempts(ip_address)
  WHERE ip_address IS NOT NULL;


-- ============================================================
-- 3. reports: tighten INSERT and remove overly permissive
--    system UPDATE policy
-- ============================================================

-- Drop the old policies so we can recreate them
DROP POLICY IF EXISTS "authenticated users can create reports" ON public.reports;
DROP POLICY IF EXISTS "system can update reports" ON public.reports;

-- INSERT: enforce that reporter matches auth user, status is pending, no reviewer set
CREATE POLICY "authenticated users can create reports"
  ON public.reports FOR INSERT
  WITH CHECK (
    auth.uid() = reporter_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

-- The remaining UPDATE policy ("server owners can update reports") stays as-is.
-- Service role bypasses RLS, so API-level moderator access still works.


-- ============================================================
-- 4. dm_reply_to: cross-channel constraint trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_dm_reply_same_channel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reply_to_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.direct_messages
      WHERE id = NEW.reply_to_id
        AND dm_channel_id = NEW.dm_channel_id
    ) THEN
      RAISE EXCEPTION 'reply_to_id must reference a message in the same DM channel';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_dm_reply_same_channel ON public.direct_messages;

CREATE TRIGGER trg_dm_reply_same_channel
  BEFORE INSERT OR UPDATE OF reply_to_id ON public.direct_messages
  FOR EACH ROW
  WHEN (NEW.reply_to_id IS NOT NULL)
  EXECUTE FUNCTION public.check_dm_reply_same_channel();


-- ============================================================
-- 5. member_roles: supporting index for composite FK
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_member_roles_server_user
  ON public.member_roles(server_id, user_id);


-- ============================================================
-- ROLLBACK:
-- ============================================================
-- DROP INDEX IF EXISTS idx_member_roles_server_user;
-- DROP TRIGGER IF EXISTS trg_dm_reply_same_channel ON public.direct_messages;
-- DROP FUNCTION IF EXISTS public.check_dm_reply_same_channel();
-- DROP POLICY IF EXISTS "authenticated users can create reports" ON public.reports;
-- CREATE POLICY "authenticated users can create reports" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
-- CREATE POLICY "system can update reports" ON public.reports FOR UPDATE USING (TRUE);
-- DROP INDEX IF EXISTS idx_login_attempts_ip;
-- DROP POLICY IF EXISTS "Users can delete own recovery codes" ON public.recovery_codes;
-- CREATE POLICY "Users can manage own recovery codes" ON public.recovery_codes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
