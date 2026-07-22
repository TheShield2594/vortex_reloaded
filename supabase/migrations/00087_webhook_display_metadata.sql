-- Add dedicated columns for webhook display metadata instead of prefixing message content.
-- This separates identity metadata from message body, fixing issues with reply previews,
-- search results, and copied text that previously included the **[WebhookName]** prefix.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS webhook_display_name TEXT,
  ADD COLUMN IF NOT EXISTS webhook_avatar_url TEXT;

COMMENT ON COLUMN public.messages.webhook_display_name IS
  'Display name override for webhook messages. Non-null only when webhook_id is set.';
COMMENT ON COLUMN public.messages.webhook_avatar_url IS
  'Avatar URL override for webhook messages. Non-null only when webhook_id is set.';

-- Backfill existing webhook messages: extract the **[DisplayName]** prefix from
-- content and populate webhook_display_name. Also copy avatar_url from the
-- linked webhook row.
UPDATE public.messages m
SET
  webhook_display_name = COALESCE(
    -- Extract name from the **[Name]** prefix pattern
    CASE
      WHEN m.content LIKE '**[%]** %'
      THEN substring(m.content FROM 4 FOR position(']**' IN substring(m.content FROM 4)) - 1)
    END,
    w.name,
    'Webhook'
  ),
  webhook_avatar_url = CASE
    WHEN w.avatar_url IS NULL THEN NULL
    WHEN LENGTH(w.avatar_url) > 2048 THEN NULL
    WHEN w.avatar_url !~ '^https?://' THEN NULL
    ELSE w.avatar_url
  END,
  -- Strip the **[Name]** prefix from content
  content = CASE
    WHEN m.content LIKE '**[%]** %'
    THEN substring(m.content FROM position(']** ' IN m.content) + 4)
    ELSE m.content
  END
FROM public.webhooks w
WHERE m.webhook_id IS NOT NULL
  AND m.webhook_id = w.id
  AND m.webhook_display_name IS NULL;
