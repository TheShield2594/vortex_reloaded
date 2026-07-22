-- ============================================================
-- Onboarding flag for first-time user experience
--
-- Tracks whether a user has completed the onboarding flow.
-- NULL means they haven't completed it yet; a timestamp marks
-- when they finished (or explicitly skipped).
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.users.onboarding_completed_at IS
  'Timestamp when the user completed (or skipped) the onboarding wizard. NULL = not yet onboarded.';
