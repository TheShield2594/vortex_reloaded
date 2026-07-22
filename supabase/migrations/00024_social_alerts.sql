-- ─── Social alerts (RSS -> channel) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS social_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id      UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'RSS Feed',
  feed_url       TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  last_item_id   TEXT,
  last_checked_at TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, feed_url)
);

CREATE INDEX IF NOT EXISTS social_alerts_server_id_idx ON social_alerts(server_id);
CREATE INDEX IF NOT EXISTS social_alerts_channel_id_idx ON social_alerts(channel_id);
CREATE INDEX IF NOT EXISTS social_alerts_enabled_idx ON social_alerts(enabled) WHERE enabled = TRUE;

CREATE OR REPLACE FUNCTION set_social_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_social_alerts_updated_at_trigger ON social_alerts;
CREATE TRIGGER set_social_alerts_updated_at_trigger
  BEFORE UPDATE ON social_alerts
  FOR EACH ROW
  EXECUTE FUNCTION set_social_alerts_updated_at();

ALTER TABLE social_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server members can view social alerts"
  ON social_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM server_members
      WHERE server_members.server_id = social_alerts.server_id
        AND server_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage social alerts"
  ON social_alerts FOR ALL
  USING (
    public.has_permission(social_alerts.server_id, 128 /* ADMINISTRATOR */)
  );
