-- Increase the custom CSS character limit from 12,000 to 50,000 to support
-- full custom themes (many popular themes exceed 12 KB).

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_appearance_settings_custom_css_length_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_appearance_settings_custom_css_length_check
  CHECK (length(coalesce(appearance_settings->>'customCss', '')) <= 50000);
