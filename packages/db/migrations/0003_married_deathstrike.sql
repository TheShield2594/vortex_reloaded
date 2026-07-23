CREATE TABLE `ntfy_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ntfy_subscriptions_topic_unique` ON `ntfy_subscriptions` (`topic`);