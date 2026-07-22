-- Add vanity invite URL support to servers.
-- A vanity_url is a custom, human-readable slug (e.g., "gaming-hub") that maps
-- to a server invite. Only one vanity URL per server; globally unique.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS vanity_url TEXT UNIQUE;

-- Enforce slug format: 3-32 lowercase alphanumeric + hyphens, no leading/trailing hyphens
ALTER TABLE public.servers
  ADD CONSTRAINT servers_vanity_url_format
  CHECK (vanity_url IS NULL OR vanity_url ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$');

-- Index for fast lookups on the invite landing page
CREATE INDEX IF NOT EXISTS idx_servers_vanity_url ON public.servers (vanity_url)
  WHERE vanity_url IS NOT NULL;

-- RLS: anyone can read vanity URLs (for the public invite page)
-- Existing servers RLS policies already cover SELECT; the new column is included.
-- UPDATE on vanity_url is restricted to the server owner via API-level checks.
