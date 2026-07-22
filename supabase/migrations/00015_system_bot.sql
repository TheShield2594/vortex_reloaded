-- ============================================================
-- System / AutoMod bot user
--
-- A fixed, well-known user that the application uses to attribute
-- system-generated messages (e.g. AutoMod channel alerts) so they
-- don't appear to come from the violating member.
--
-- This user never authenticates; it has no password and its email
-- is an internal-only address.  The id is pinned so application
-- code can reference it as a constant.
-- ============================================================

DO $$
DECLARE
  _has_instance_id BOOLEAN;
  _has_is_super_admin BOOLEAN;
BEGIN
  -- Insert into auth.users only if the row doesn't already exist.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    -- Detect whether deprecated columns still exist (removed in newer Supabase).
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'instance_id'
    ) INTO _has_instance_id;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_super_admin'
    ) INTO _has_is_super_admin;

    IF _has_instance_id AND _has_is_super_admin THEN
      -- Legacy Supabase: include instance_id and is_super_admin
      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        banned_until
      ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'automod@system.internal',
        '',                 -- no password; this user never logs in
        NOW(),
        NOW(),
        NOW(),
        '{"provider":"system","providers":["system"]}',
        '{}',
        FALSE,
        'infinity'::timestamptz  -- permanently blocked from GoTrue auth flows
      );
    ELSE
      -- Newer Supabase: omit deprecated columns
      INSERT INTO auth.users (
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        banned_until
      ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        'authenticated',
        'authenticated',
        'automod@system.internal',
        '',
        NOW(),
        NOW(),
        NOW(),
        '{"provider":"system","providers":["system"]}',
        '{}',
        'infinity'::timestamptz
      );
    END IF;
  END IF;
END;
$$;

-- Matching public profile row (id FK → auth.users).
INSERT INTO public.users (id, username, display_name, status, avatar_url)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'automod',
  'AutoMod',
  'online',
  NULL
)
ON CONFLICT (id) DO NOTHING;
