-- Remove RSS feed / social alerts feature
-- The social_alerts table, its triggers, indexes, and RLS policies are all
-- dropped automatically via CASCADE and DROP TABLE.

DROP TRIGGER IF EXISTS set_social_alerts_updated_at_trigger ON social_alerts;
DROP FUNCTION IF EXISTS set_social_alerts_updated_at();
DROP TABLE IF EXISTS social_alerts;
