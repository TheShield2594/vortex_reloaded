CREATE TABLE `registration_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_by` text,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "registration_invites_max_uses_check" CHECK("registration_invites"."max_uses" >= 1),
	CONSTRAINT "registration_invites_use_count_check" CHECK("registration_invites"."use_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_invites_code_unique` ON `registration_invites` (`code`);--> statement-breakpoint
CREATE INDEX `idx_registration_invites_created_by` ON `registration_invites` (`created_by`);