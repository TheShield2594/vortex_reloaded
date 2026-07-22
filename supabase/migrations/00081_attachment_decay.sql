-- Migration: Attachment Decay
-- Adds size-based expiry tracking to attachments and dm_attachments tables.
-- Fluxer-style: smaller files live longer, access near expiry renews the deadline.

-- ── Channel attachments ─────────────────────────────────────────────────────

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifetime_days   INTEGER,
  ADD COLUMN IF NOT EXISTS decay_cost      DOUBLE PRECISION;

-- Index for the cleanup cron: find expired, non-purged attachments efficiently.
CREATE INDEX IF NOT EXISTS idx_attachments_decay_expiry
  ON public.attachments (expires_at)
  WHERE expires_at IS NOT NULL AND purged_at IS NULL;

-- ── DM attachments ──────────────────────────────────────────────────────────

ALTER TABLE public.dm_attachments
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifetime_days   INTEGER,
  ADD COLUMN IF NOT EXISTS decay_cost      DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_dm_attachments_decay_expiry
  ON public.dm_attachments (expires_at)
  WHERE expires_at IS NOT NULL AND purged_at IS NULL;

-- ── Backfill existing attachments ───────────────────────────────────────────
-- Set expires_at for existing rows based on their size and created_at.
-- Uses the same formula: ≤5 MB → 3 years, ≥500 MB → 14 days, log-linear blend.

DO $$
DECLARE
  min_mb   CONSTANT DOUBLE PRECISION := 5;
  max_mb   CONSTANT DOUBLE PRECISION := 500;
  min_days CONSTANT DOUBLE PRECISION := 14;
  max_days CONSTANT DOUBLE PRECISION := 1095; -- 365 * 3
  curve    CONSTANT DOUBLE PRECISION := 0.5;
BEGIN
  -- Channel attachments
  UPDATE public.attachments
  SET
    expires_at = created_at + make_interval(
      days := CASE
        WHEN (size::double precision / 1048576) <= min_mb THEN max_days::int
        WHEN (size::double precision / 1048576) >= max_mb THEN min_days::int
        ELSE ROUND(
          max_days - (
            (1 - curve) * ((size::double precision / 1048576 - min_mb) / (max_mb - min_mb))
            + curve * (ln(size::double precision / 1048576 / min_mb) / ln(max_mb / min_mb))
          ) * (max_days - min_days)
        )::int
      END
    ),
    last_accessed_at = created_at,
    lifetime_days = CASE
      WHEN (size::double precision / 1048576) <= min_mb THEN max_days::int
      WHEN (size::double precision / 1048576) >= max_mb THEN min_days::int
      ELSE ROUND(
        max_days - (
          (1 - curve) * ((size::double precision / 1048576 - min_mb) / (max_mb - min_mb))
          + curve * (ln(size::double precision / 1048576 / min_mb) / ln(max_mb / min_mb))
        ) * (max_days - min_days)
      )::int
    END
  WHERE expires_at IS NULL;

  -- DM attachments
  UPDATE public.dm_attachments
  SET
    expires_at = created_at + make_interval(
      days := CASE
        WHEN (size::double precision / 1048576) <= min_mb THEN max_days::int
        WHEN (size::double precision / 1048576) >= max_mb THEN min_days::int
        ELSE ROUND(
          max_days - (
            (1 - curve) * ((size::double precision / 1048576 - min_mb) / (max_mb - min_mb))
            + curve * (ln(size::double precision / 1048576 / min_mb) / ln(max_mb / min_mb))
          ) * (max_days - min_days)
        )::int
      END
    ),
    last_accessed_at = created_at,
    lifetime_days = CASE
      WHEN (size::double precision / 1048576) <= min_mb THEN max_days::int
      WHEN (size::double precision / 1048576) >= max_mb THEN min_days::int
      ELSE ROUND(
        max_days - (
          (1 - curve) * ((size::double precision / 1048576 - min_mb) / (max_mb - min_mb))
          + curve * (ln(size::double precision / 1048576 / min_mb) / ln(max_mb / min_mb))
        ) * (max_days - min_days)
      )::int
    END
  WHERE expires_at IS NULL;
END $$;
