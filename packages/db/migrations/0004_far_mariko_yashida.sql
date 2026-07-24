CREATE TABLE `dm_membership_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dm_channel_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text,
	`target_id` text,
	`actor_device_id` text,
	`actor_ed25519_key` text,
	`payload` text NOT NULL,
	`signature` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dm_channel_id`) REFERENCES `dm_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "dm_membership_events_action_check" CHECK("dm_membership_events"."action" in ('member_added', 'member_removed', 'member_left'))
);
--> statement-breakpoint
CREATE INDEX `idx_dm_membership_events_channel_created` ON `dm_membership_events` (`dm_channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `safety_number_verifications` (
	`user_id` text NOT NULL,
	`other_user_id` text NOT NULL,
	`safety_number_fingerprint` text NOT NULL,
	`verified_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `other_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`other_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`icon_url` text,
	`server_id` text,
	`channel_id` text,
	`message_id` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_type_check" CHECK("__new_notifications"."type" in ('mention', 'reply', 'friend_request', 'server_invite', 'system', 'verify_prompt'))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "type", "title", "body", "icon_url", "server_id", "channel_id", "message_id", "read", "created_at") SELECT "id", "user_id", "type", "title", "body", "icon_url", "server_id", "channel_id", "message_id", "read", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`user_id`,`created_at`) WHERE "notifications"."read" = 0;