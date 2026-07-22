-- Persist per-user appearance settings including theme preset and custom CSS.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS appearance_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_appearance_settings_custom_css_length_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_appearance_settings_custom_css_length_check
      CHECK (length(coalesce(appearance_settings->>'customCss', '')) <= 12000);
  END IF;
END
$$;
