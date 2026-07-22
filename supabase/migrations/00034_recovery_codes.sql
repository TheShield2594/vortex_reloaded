-- Recovery codes for account recovery when passkey/TOTP are unavailable
-- Each user gets 10 single-use codes generated during MFA enrollment
-- Codes are stored as bcrypt hashes for security

CREATE TABLE IF NOT EXISTS public.recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id ON public.recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_unused ON public.recovery_codes(user_id) WHERE used_at IS NULL;

ALTER TABLE public.recovery_codes ENABLE ROW LEVEL SECURITY;

-- Users can read their own codes (to see count remaining) but service role handles insert/update
DROP POLICY IF EXISTS "Users can view own recovery codes" ON public.recovery_codes;
CREATE POLICY "Users can view own recovery codes"
  ON public.recovery_codes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own recovery codes" ON public.recovery_codes;
CREATE POLICY "Users can manage own recovery codes"
  ON public.recovery_codes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Users can manage own recovery codes" ON public.recovery_codes;
-- DROP POLICY IF EXISTS "Users can view own recovery codes" ON public.recovery_codes;
-- DROP INDEX IF EXISTS idx_recovery_codes_user_unused;
-- DROP INDEX IF EXISTS idx_recovery_codes_user_id;
-- DROP TABLE IF EXISTS public.recovery_codes;
