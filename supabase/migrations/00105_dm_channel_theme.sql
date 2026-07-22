-- Per-conversation theming.
--
-- Lets any member of a DM/group channel set a theme preset that applies to
-- that conversation's chat chrome for everyone in it. Uses the same preset
-- catalog as the existing user-level appearance settings (see
-- apps/web/lib/stores/appearance-store.ts ThemePreset / apps/web/lib/dm-theme.ts)
-- but stores the value in a real column rather than a JSON blob.
--
-- NULL means "no conversation theme set" — the chat falls back to each
-- viewer's own personal appearance settings.

ALTER TABLE public.dm_channels
  ADD COLUMN IF NOT EXISTS theme_preset TEXT;

ALTER TABLE public.dm_channels
  DROP CONSTRAINT IF EXISTS dm_channels_theme_preset_check;

ALTER TABLE public.dm_channels
  ADD CONSTRAINT dm_channels_theme_preset_check
  CHECK (
    theme_preset IS NULL OR theme_preset IN (
      'twilight', 'midnight-neon', 'synthwave', 'carbon', 'oled-black',
      'frost', 'clarity', 'velvet-dusk', 'terminal', 'sakura-blossom',
      'frosthearth', 'night-city-neural'
    )
  );

-- Members update theme_preset through this RPC rather than a direct UPDATE
-- against dm_channels, so we don't have to widen the existing owner-only
-- "dm members can update channels" RLS policy (which also guards name/icon)
-- to all members just to let them set a shared cosmetic preference.
CREATE OR REPLACE FUNCTION public.set_dm_channel_theme(p_dm_channel_id UUID, p_theme_preset TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_theme_preset IS NOT NULL AND p_theme_preset NOT IN (
    'twilight', 'midnight-neon', 'synthwave', 'carbon', 'oled-black',
    'frost', 'clarity', 'velvet-dusk', 'terminal', 'sakura-blossom',
    'frosthearth', 'night-city-neural'
  ) THEN
    RAISE EXCEPTION 'invalid theme_preset: %', p_theme_preset;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.dm_channel_members
    WHERE dm_channel_id = p_dm_channel_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a member of this conversation';
  END IF;

  UPDATE public.dm_channels
  SET theme_preset = p_theme_preset
  WHERE id = p_dm_channel_id;
END;
$$;
