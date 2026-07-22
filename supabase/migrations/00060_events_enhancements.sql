-- Events system enhancements: banner image, event type, external URL
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS banner_url text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'general'
  CHECK (event_type IN ('general', 'voice', 'external'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS external_url text;

COMMENT ON COLUMN public.events.banner_url IS 'Public URL of the event banner image stored in event-banners storage bucket';
COMMENT ON COLUMN public.events.event_type IS 'Type of event: general, voice (linked to a voice channel), or external (has an external URL)';
COMMENT ON COLUMN public.events.external_url IS 'External join URL for events of type external';
