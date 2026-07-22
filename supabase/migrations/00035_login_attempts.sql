-- Brute-force protection: track failed login attempts per email
-- After 5 failed attempts in 15 minutes, impose a 15-minute lockout
-- Successful logins clear attempt records for that email

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON public.login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_recent ON public.login_attempts(email, attempted_at DESC);

-- No RLS — this table is managed exclusively by server-side API routes via service role
-- Anonymous users should not have direct access
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (no user-facing policies)
-- The service role client bypasses RLS automatically

-- Helper function to check if an email is currently locked out
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to record a failed login attempt
CREATE OR REPLACE FUNCTION public.record_login_attempt(target_email TEXT, target_ip TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.login_attempts (email, ip_address)
  VALUES (LOWER(target_email), target_ip);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to clear login attempts on successful login
CREATE OR REPLACE FUNCTION public.clear_login_attempts(target_email TEXT)
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.login_attempts
  WHERE email = LOWER(target_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Periodic cleanup: remove attempts older than 1 hour to keep table lean
-- (Can be invoked via pg_cron or a periodic API call)
CREATE OR REPLACE FUNCTION public.cleanup_old_login_attempts()
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.login_attempts
  WHERE attempted_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.cleanup_old_login_attempts();
-- DROP FUNCTION IF EXISTS public.clear_login_attempts(TEXT);
-- DROP FUNCTION IF EXISTS public.record_login_attempt(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.is_login_locked_out(TEXT);
-- DROP INDEX IF EXISTS idx_login_attempts_email_recent;
-- DROP INDEX IF EXISTS idx_login_attempts_email;
-- DROP TABLE IF EXISTS public.login_attempts;
