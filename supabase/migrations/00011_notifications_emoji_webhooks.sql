-- ─── In-app notifications ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('mention', 'reply', 'friend_request', 'server_invite', 'system')),
  title       TEXT NOT NULL,
  body        TEXT,
  icon_url    TEXT,
  -- Deep-link context
  server_id   UUID REFERENCES servers(id) ON DELETE SET NULL,
  channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
  message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx  ON notifications(user_id, read) WHERE read = FALSE;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- INSERT is intentionally omitted: the service role bypasses RLS and is the
-- only principal that should insert notifications.  No policy is needed here;
-- a permissive WITH CHECK (TRUE) policy would allow any authenticated user to
-- insert notifications for arbitrary user_ids.

-- ─── Custom server emoji ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_emojis (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,          -- slug used in :name: syntax
  image_url   TEXT NOT NULL,
  uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(server_id, name)
);

CREATE INDEX IF NOT EXISTS server_emojis_server_id_idx ON server_emojis(server_id);

ALTER TABLE server_emojis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server members can view emojis"
  ON server_emojis FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM server_members
      WHERE server_members.server_id = server_emojis.server_id
        AND server_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage emojis"
  ON server_emojis FOR ALL
  USING (
    public.has_permission(server_emojis.server_id, 128 /* ADMINISTRATOR */)
  );

-- ─── Webhooks ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Webhook',
  avatar_url  TEXT,
  token       TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhooks_token_idx ON webhooks(token);
CREATE INDEX IF NOT EXISTS webhooks_server_id_idx ON webhooks(server_id);
CREATE INDEX IF NOT EXISTS webhooks_channel_id_idx ON webhooks(channel_id);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server members can view webhooks"
  ON webhooks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM server_members
      WHERE server_members.server_id = webhooks.server_id
        AND server_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage webhooks"
  ON webhooks FOR ALL
  USING (
    public.has_permission(webhooks.server_id, 128 /* ADMINISTRATOR */)
  );
