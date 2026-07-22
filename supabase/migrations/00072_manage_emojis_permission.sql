-- Migration: Add MANAGE_EMOJIS permission (bit 20 = 1048576)
-- Replaces ADMINISTRATOR-only gating on emoji storage and table RLS with
-- the new MANAGE_EMOJIS permission, so non-admin members with the right
-- role can upload/manage custom emojis.
--
-- NOTE: MANAGE_EMOJIS is NOT granted to default roles. Server admins must
-- explicitly enable it on roles via the role settings UI. Administrators
-- already bypass all permission checks so they don't need the explicit bit.

-- ── Backfill: grant MANAGE_EMOJIS to roles that already have ADMINISTRATOR ───
-- This ensures the RLS policies keep working for existing admin roles whose
-- permissions are checked at the DB level (where ADMINISTRATOR bypass is in
-- the app layer, not in the has_permission() SQL function).
UPDATE public.roles
SET    permissions = permissions | 1048576
WHERE  (permissions & 128) != 0;

-- ── Update server_emojis table RLS ───────────────────────────────────────────
-- Drop the old ADMINISTRATOR-only policy and create one that accepts either
-- MANAGE_EMOJIS or ADMINISTRATOR.  The SQL has_permission() function does NOT
-- do an ADMINISTRATOR bypass (unlike the TypeScript version), so we must
-- explicitly check both bits to cover newly-created admin roles that won't
-- have the MANAGE_EMOJIS bit from the backfill above.
DROP POLICY IF EXISTS "Admins can manage emojis" ON server_emojis;

CREATE POLICY "Emoji managers and admins can manage emojis"
  ON server_emojis FOR ALL
  USING (
    public.has_permission(server_emojis.server_id, 1048576 /* MANAGE_EMOJIS */)
    OR public.has_permission(server_emojis.server_id, 128 /* ADMINISTRATOR */)
  );

-- ── Update storage RLS for server-emojis bucket ─────────────────────────────
-- Replace ADMINISTRATOR (128) with MANAGE_EMOJIS (1048576) OR ADMINISTRATOR.

DROP POLICY IF EXISTS "Admins can upload server emojis"  ON storage.objects;
DROP POLICY IF EXISTS "Admins can update server emojis"  ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete server emojis"  ON storage.objects;

CREATE POLICY "Emoji managers can upload server emojis"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'server-emojis' AND (
      public.has_permission(((storage.foldername(name))[1])::uuid, 1048576)
      OR public.has_permission(((storage.foldername(name))[1])::uuid, 128)
    )
  );

CREATE POLICY "Emoji managers can update server emojis"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'server-emojis' AND (
      public.has_permission(((storage.foldername(name))[1])::uuid, 1048576)
      OR public.has_permission(((storage.foldername(name))[1])::uuid, 128)
    )
  );

CREATE POLICY "Emoji managers can delete server emojis"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'server-emojis' AND (
      public.has_permission(((storage.foldername(name))[1])::uuid, 1048576)
      OR public.has_permission(((storage.foldername(name))[1])::uuid, 128)
    )
  );
