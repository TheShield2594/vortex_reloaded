DROP INDEX `idx_users_presence_heartbeat`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `last_heartbeat_at`;