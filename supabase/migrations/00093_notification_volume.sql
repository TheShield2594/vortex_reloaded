-- Add notification_volume column to user_notification_preferences
-- Stores a float 0.0–1.0 (maps to 0%–100% in the UI)
ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS notification_volume REAL NOT NULL DEFAULT 0.5
  CHECK (notification_volume >= 0 AND notification_volume <= 1);
