-- Server emoji storage bucket + RLS policies

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'server-emojis',
  'server-emojis',
  TRUE,
  262144,
  ARRAY['image/png', 'image/gif', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Anyone can view server emojis'
  ) THEN
    CREATE POLICY "Anyone can view server emojis"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'server-emojis');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admins can upload server emojis'
  ) THEN
    CREATE POLICY "Admins can upload server emojis"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'server-emojis' AND
        public.has_permission(((storage.foldername(name))[1])::uuid, 128)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admins can update server emojis'
  ) THEN
    CREATE POLICY "Admins can update server emojis"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'server-emojis' AND
        public.has_permission(((storage.foldername(name))[1])::uuid, 128)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admins can delete server emojis'
  ) THEN
    CREATE POLICY "Admins can delete server emojis"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'server-emojis' AND
        public.has_permission(((storage.foldername(name))[1])::uuid, 128)
      );
  END IF;
END
$$;
