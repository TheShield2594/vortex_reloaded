-- Add image variant columns to support the media processing pipeline.
-- blur_hash: tiny base83-encoded blurhash string (~30 bytes) for placeholder
-- variants: JSONB storing URLs/paths for thumbnail + standard variants
--   e.g. { "thumbnail": { "path": "...", "width": 200, "height": 150 },
--          "standard":  { "path": "...", "width": 1200, "height": 900 } }
-- processing_state: tracks async image processing status

DO $$
BEGIN
  CREATE TYPE attachment_processing_state AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS blur_hash TEXT,
  ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS processing_state attachment_processing_state DEFAULT NULL;

-- Index for finding attachments that need processing
CREATE INDEX IF NOT EXISTS idx_attachments_processing_pending
  ON public.attachments (processing_state)
  WHERE processing_state = 'pending';

COMMENT ON COLUMN public.attachments.blur_hash IS 'BlurHash placeholder string for progressive image loading';
COMMENT ON COLUMN public.attachments.variants IS 'JSONB map of image variants (thumbnail, standard) with path/width/height';
COMMENT ON COLUMN public.attachments.processing_state IS 'Async image processing state: pending → processing → completed/failed';
