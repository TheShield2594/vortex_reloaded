-- Add 'biweekly' and 'yearly' to the recurrence CHECK constraint on events table
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_recurrence_check;
ALTER TABLE events ADD CONSTRAINT events_recurrence_check
  CHECK (recurrence IN ('none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'));
