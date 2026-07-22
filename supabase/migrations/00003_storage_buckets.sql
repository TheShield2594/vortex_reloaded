-- Supabase Storage Buckets

-- Public bucket for avatars and server icons
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Public bucket for server icons
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'server-icons',
  'server-icons',
  TRUE,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Private bucket for message attachments (signed URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'attachments',
  'attachments',
  FALSE,
  52428800 -- 50MB
) ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars (public read)
CREATE POLICY "Anyone can view avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::TEXT = (storage.foldername(name))[1]
  );

-- Storage policies for server icons (public read)
CREATE POLICY "Anyone can view server icons"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'server-icons');

CREATE POLICY "Server owners can upload server icons"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'server-icons' AND
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE id::TEXT = (storage.foldername(name))[1]
        AND owner_id = auth.uid()
    )
  );

CREATE POLICY "Server owners can update server icons"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'server-icons' AND
    EXISTS (
      SELECT 1 FROM public.servers
      WHERE id::TEXT = (storage.foldername(name))[1]
        AND owner_id = auth.uid()
    )
  );

-- Storage policies for attachments (private, server members only)
CREATE POLICY "Server members can view attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Authenticated users can upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments' AND
    auth.uid() IS NOT NULL
  );
