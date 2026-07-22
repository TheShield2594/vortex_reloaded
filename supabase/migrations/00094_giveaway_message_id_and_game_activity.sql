-- #632: Add message_id to giveaways for reaction-based entry
ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- #531: Add game_activity to users for showing what games people are playing
ALTER TABLE users ADD COLUMN IF NOT EXISTS game_activity JSONB DEFAULT NULL;
-- game_activity schema: { "game_name": string, "game_id": string | null, "started_at": string, "source": "steam" | "manual" }

-- Index for efficient giveaway lookup by message_id (used by reaction-based entry)
CREATE INDEX IF NOT EXISTS idx_giveaways_message_id ON giveaways(message_id) WHERE message_id IS NOT NULL;
