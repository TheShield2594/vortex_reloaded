-- Fix: RSS Feed Bot and Bible Bot not appearing in the app marketplace.
--
-- Migration 00103 used ON CONFLICT (slug) DO NOTHING when inserting
-- these catalog entries.  If rows with these slugs already existed
-- (e.g. from a partial migration or manual insert) with
-- is_published = FALSE, the inserts were silently skipped and the apps
-- stayed invisible in the marketplace.
--
-- This migration upserts both entries so is_published is guaranteed TRUE
-- and core metadata matches the canonical values.
-- (Same pattern as 00071_fix_giveaway_reminder_bot_visibility.sql)

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity, is_published)
VALUES (
  'rss-feed-bot',
  'RSS Feed Bot',
  'Subscribe to RSS feeds and automatically post new articles as embed messages in your channels. Add URLs and the bot transforms them into rich embed posts.',
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

INSERT INTO public.app_catalog (slug, name, description, category, install_scopes, permissions, trust_badge, identity, is_published)
VALUES (
  'bible-bot',
  'Bible Bot',
  'Deliver daily Bible verses to your server channels. Powered by scripture.api.bible — configure your API key, choose a Bible translation, and set a daily delivery time.',
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

-- Ensure rate limits exist for both apps
INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'rss-feed-bot'
ON CONFLICT (app_id) DO NOTHING;

INSERT INTO public.app_rate_limits (app_id, requests_per_minute, burst)
SELECT id, 120, 30 FROM public.app_catalog WHERE slug = 'bible-bot'
ON CONFLICT (app_id) DO NOTHING;
