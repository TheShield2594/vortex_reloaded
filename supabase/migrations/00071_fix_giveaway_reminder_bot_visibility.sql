-- Fix: Giveaway Bot and Reminder Bot not appearing in the app marketplace.
--
-- Migrations 00066 and 00068 used ON CONFLICT (slug) DO NOTHING when
-- inserting these catalog entries.  If rows with these slugs already
-- existed (e.g. from a partial migration or manual insert) with
-- is_published = FALSE, the inserts were silently skipped and the apps
-- stayed invisible in the marketplace.
--
-- This migration upserts both entries so is_published is guaranteed TRUE
-- and core metadata matches the canonical values.

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity, is_published)
VALUES (
  'giveaway-bot',
  'Giveaway Bot',
  'Run giveaways in your server! Set a giveaway channel, create timed giveaways with prizes, and automatically draw winners.',
  'community',
  ARRAY['server','channel'],
  ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  'verified',
  '{"publisher":"VortexChat"}'::jsonb,
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  category       = EXCLUDED.category,
  install_scopes = EXCLUDED.install_scopes,
  permissions    = EXCLUDED.permissions,
  trust_badge    = EXCLUDED.trust_badge,
  identity       = EXCLUDED.identity,
  is_published   = TRUE;

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity, is_published)
VALUES (
  'reminder-bot',
  'Reminder Bot',
  'Set personal reminders up to 24 hours in advance. Use /reminder to schedule a reminder with a message and time, and get notified when it''s due.',
  'productivity',
  ARRAY['server','channel'],
  ARRAY['SEND_MESSAGES','READ_MESSAGES'],
  'verified',
  '{"publisher":"VortexChat"}'::jsonb,
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  category       = EXCLUDED.category,
  install_scopes = EXCLUDED.install_scopes,
  permissions    = EXCLUDED.permissions,
  trust_badge    = EXCLUDED.trust_badge,
  identity       = EXCLUDED.identity,
  is_published   = TRUE;

-- Ensure rate limits exist for both apps
INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'giveaway-bot'
ON CONFLICT (app_id) DO NOTHING;

INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'reminder-bot'
ON CONFLICT (app_id) DO NOTHING;
