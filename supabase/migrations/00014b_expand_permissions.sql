-- Migration: Expand permissions toward Discord-level granularity
-- Adds per-member timeout tracking to server_members and grants
-- USE_APPLICATION_COMMANDS to all default roles.
--
-- Depends on: 00014_channel_types.sql (channels schema)
-- See also:   00014c_moderation.sql — defines the member_timeouts table and
--             the set_member_timeout() function that enforces the timeout_until column.

-- ── Timeout column on server_members ─────────────────────────────────────────
-- A denormalised snapshot of the active timeout expiry for fast RLS evaluation.
-- Authoritative timeout records live in member_timeouts (00014c_moderation.sql).
ALTER TABLE public.server_members
  ADD COLUMN IF NOT EXISTS timeout_until TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_server_members_timeout_until
  ON public.server_members (server_id, user_id, timeout_until)
  WHERE timeout_until IS NOT NULL;

-- ── RLS: moderators may update the timeout_until column ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename   = 'server_members'
      AND policyname  = 'Moderators can update member timeout'
  ) THEN
    CREATE POLICY "Moderators can update member timeout"
      ON public.server_members FOR UPDATE
      USING (
        public.is_server_owner(server_id) OR
        public.has_permission(server_id, 16384) -- MODERATE_MEMBERS
      )
      WITH CHECK (
        public.is_server_owner(server_id) OR
        public.has_permission(server_id, 16384)
      );
  END IF;
END;
$$;

-- ── Backfill: grant USE_APPLICATION_COMMANDS to existing default roles ────────
-- Bit 262144 = USE_APPLICATION_COMMANDS.  Only non-admin default roles need the
-- explicit grant; ADMINISTRATOR (128) already implies all permissions.
UPDATE public.roles
SET    permissions = permissions | 262144
WHERE  is_default = TRUE
  AND  (permissions & 128) = 0;
