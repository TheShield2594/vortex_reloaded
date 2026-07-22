-- ============================================================
-- Fix server-icons storage upload policy
--
-- The original INSERT/UPDATE policies checked that the upload
-- path starts with a server ID folder, but create-server-modal
-- uploads the icon BEFORE the server row exists (chicken-and-egg)
-- using a flat path like `<uuid>.<ext>` with no folder.
-- foldername('<uuid>.gif')[1] returns NULL, so the EXISTS check
-- always evaluates to FALSE and every upload is rejected.
--
-- Since the bucket is already public=TRUE (anyone can read), the
-- only gate we need on write is "is the user logged in?"
-- ============================================================

DROP POLICY IF EXISTS "Server owners can upload server icons" ON storage.objects;
DROP POLICY IF EXISTS "Server owners can update server icons" ON storage.objects;

CREATE POLICY "Authenticated users can upload server icons"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'server-icons' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Authenticated users can update server icons"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'server-icons' AND
    auth.uid() IS NOT NULL
  );

-- ============================================================
-- Fix existing server icon URLs that are missing /public/ in
-- the path (uploaded before this bug was identified).
-- Old format: .../storage/v1/object/server-icons/<file>
-- New format: .../storage/v1/object/public/server-icons/<file>
-- ============================================================
UPDATE public.servers
SET icon_url = regexp_replace(
  icon_url,
  '(/storage/v1/object/)(server-icons/)',
  '\1public/\2'
)
WHERE icon_url IS NOT NULL
  AND icon_url ~ '/storage/v1/object/server-icons/';
