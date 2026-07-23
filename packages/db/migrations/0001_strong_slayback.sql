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
CREATE INDEX `idx_registration_invites_created_by` ON `registration_invites` (`created_by`);--> statement-breakpoint
CREATE TABLE `olm_device_identities` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`curve25519_identity_key` text NOT NULL,
	`ed25519_identity_key` text NOT NULL,
	`fallback_key_id` text NOT NULL,
	`fallback_public_key` text NOT NULL,
	`fallback_signature` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `olm_one_time_keys` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`key_id` text NOT NULL,
	`public_key` text NOT NULL,
	`signature` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`, `key_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `olm_one_time_keys_claim_idx` ON `olm_one_time_keys` (`user_id`,`device_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_two_factors`("id", "user_id", "secret", "backup_codes", "verified", "failed_verification_count", "locked_until") SELECT "id", "user_id", "secret", "backup_codes", "verified", "failed_verification_count", "locked_until" FROM `two_factors`;--> statement-breakpoint
DROP TABLE `two_factors`;--> statement-breakpoint
ALTER TABLE `__new_two_factors` RENAME TO `two_factors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_dm_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`icon_url` text,
	`owner_id` text,
	`is_group` integer DEFAULT false NOT NULL,
	`is_encrypted` integer DEFAULT false NOT NULL,
	`encryption_key_version` integer DEFAULT 1 NOT NULL,
	`encryption_membership_epoch` integer DEFAULT 0 NOT NULL,
	`encryption_scheme` text DEFAULT 'legacy-ecdh' NOT NULL,
	`theme_preset` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "dm_channels_theme_preset_check" CHECK("__new_dm_channels"."theme_preset" is null or "__new_dm_channels"."theme_preset" in (
        'twilight', 'midnight-neon', 'synthwave', 'carbon', 'oled-black',
        'frost', 'clarity', 'velvet-dusk', 'terminal', 'sakura-blossom',
        'frosthearth', 'night-city-neural'
      )),
	CONSTRAINT "dm_channels_encryption_scheme_check" CHECK("__new_dm_channels"."encryption_scheme" in ('legacy-ecdh', 'olm'))
);
--> statement-breakpoint
INSERT INTO `__new_dm_channels`("id", "name", "icon_url", "owner_id", "is_group", "is_encrypted", "encryption_key_version", "encryption_membership_epoch", "encryption_scheme", "theme_preset", "created_at", "updated_at") SELECT "id", "name", "icon_url", "owner_id", "is_group", "is_encrypted", "encryption_key_version", "encryption_membership_epoch", 'legacy-ecdh', "theme_preset", "created_at", "updated_at" FROM `dm_channels`;--> statement-breakpoint
DROP TABLE `dm_channels`;--> statement-breakpoint
ALTER TABLE `__new_dm_channels` RENAME TO `dm_channels`;--> statement-breakpoint
CREATE INDEX `dm_channels_updated_idx` ON `dm_channels` (`updated_at`);