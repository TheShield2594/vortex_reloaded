-- ============================================================
-- Global notification type preferences per user
-- These flags let users disable specific notification types
-- (mention, reply, friend_request, server_invite, system)
-- globally, independently of per-server/channel mute settings.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id                      UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  mention_notifications        BOOLEAN     NOT NULL DEFAULT TRUE,
  reply_notifications          BOOLEAN     NOT NULL DEFAULT TRUE,
  friend_request_notifications BOOLEAN     NOT NULL DEFAULT TRUE,
  server_invite_notifications  BOOLEAN     NOT NULL DEFAULT TRUE,
  system_notifications         BOOLEAN     NOT NULL DEFAULT TRUE,
  sound_enabled                BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notification preferences"
  ON public.user_notification_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
