-- Add push_notifications, show_message_preview, show_unread_badge columns
-- to user_notification_preferences so client-side preferences persist to the DB.
ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS push_notifications    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_message_preview  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_unread_badge     BOOLEAN NOT NULL DEFAULT TRUE;
