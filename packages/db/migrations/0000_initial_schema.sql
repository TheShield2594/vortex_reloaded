CREATE TABLE `auth_security_policies` (
	`user_id` text PRIMARY KEY NOT NULL,
	`passkey_first` integer DEFAULT false NOT NULL,
	`enforce_passkey` integer DEFAULT false NOT NULL,
	`fallback_password` integer DEFAULT true NOT NULL,
	`fallback_magic_link` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_security_policies_passkey_first_check" CHECK("auth_security_policies"."passkey_first" in (0, 1)),
	CONSTRAINT "auth_security_policies_enforce_passkey_check" CHECK("auth_security_policies"."enforce_passkey" in (0, 1)),
	CONSTRAINT "auth_security_policies_fallback_password_check" CHECK("auth_security_policies"."fallback_password" in (0, 1)),
	CONSTRAINT "auth_security_policies_fallback_magic_link_check" CHECK("auth_security_policies"."fallback_magic_link" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`ip_address` text,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_email` ON `login_attempts` (`email`);--> statement-breakpoint
CREATE INDEX `idx_login_attempts_email_recent` ON `login_attempts` (`email`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `idx_login_attempts_ip` ON `login_attempts` (`ip_address`) WHERE "login_attempts"."ip_address" is not null;--> statement-breakpoint
CREATE TABLE `login_risk_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`location_hint` text,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`suspicious` integer DEFAULT false NOT NULL,
	`succeeded` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_login_risk_events_user_created` ON `login_risk_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_login_risk_events_suspicious` ON `login_risk_events` (`suspicious`,`created_at`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `direct_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`receiver_id` text,
	`content` text,
	`read_at` text,
	`edited_at` text,
	`deleted_at` text,
	`dm_channel_id` text,
	`reply_to_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dm_channel_id`) REFERENCES `dm_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_to_id`) REFERENCES `direct_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_direct_messages_sender_receiver` ON `direct_messages` (`sender_id`,`receiver_id`);--> statement-breakpoint
CREATE INDEX `idx_direct_messages_created_at` ON `direct_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_direct_messages_reply_to_id` ON `direct_messages` (`reply_to_id`) WHERE "direct_messages"."reply_to_id" is not null;--> statement-breakpoint
CREATE INDEX `idx_direct_messages_channel_created_deleted` ON `direct_messages` (`dm_channel_id`,`created_at`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `dm_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`dm_id` text NOT NULL,
	`url` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`last_accessed_at` text,
	`purged_at` text,
	`lifetime_days` integer,
	`decay_cost` real,
	FOREIGN KEY (`dm_id`) REFERENCES `direct_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dm_attachments_decay_expiry` ON `dm_attachments` (`expires_at`) WHERE "dm_attachments"."expires_at" is not null and "dm_attachments"."purged_at" is null;--> statement-breakpoint
CREATE TABLE `dm_channel_keys` (
	`dm_channel_id` text NOT NULL,
	`key_version` integer NOT NULL,
	`target_user_id` text NOT NULL,
	`target_device_id` text NOT NULL,
	`wrapped_key` text NOT NULL,
	`wrapped_by_user_id` text NOT NULL,
	`wrapped_by_device_id` text NOT NULL,
	`sender_public_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`dm_channel_id`, `key_version`, `target_user_id`, `target_device_id`),
	FOREIGN KEY (`dm_channel_id`) REFERENCES `dm_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wrapped_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dm_channel_keys_target_idx` ON `dm_channel_keys` (`target_user_id`,`target_device_id`,`dm_channel_id`,`key_version`);--> statement-breakpoint
CREATE TABLE `dm_channel_members` (
	`dm_channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text,
	`added_at` text NOT NULL,
	PRIMARY KEY(`dm_channel_id`, `user_id`),
	FOREIGN KEY (`dm_channel_id`) REFERENCES `dm_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dm_channel_members_user_idx` ON `dm_channel_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_dm_channel_members_dm_channel_id` ON `dm_channel_members` (`dm_channel_id`);--> statement-breakpoint
CREATE TABLE `dm_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`icon_url` text,
	`owner_id` text,
	`is_group` integer DEFAULT false NOT NULL,
	`is_encrypted` integer DEFAULT false NOT NULL,
	`encryption_key_version` integer DEFAULT 1 NOT NULL,
	`encryption_membership_epoch` integer DEFAULT 0 NOT NULL,
	`theme_preset` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "dm_channels_theme_preset_check" CHECK("dm_channels"."theme_preset" is null or "dm_channels"."theme_preset" in (
        'twilight', 'midnight-neon', 'synthwave', 'carbon', 'oled-black',
        'frost', 'clarity', 'velvet-dusk', 'terminal', 'sakura-blossom',
        'frosthearth', 'night-city-neural'
      ))
);
--> statement-breakpoint
CREATE INDEX `dm_channels_updated_idx` ON `dm_channels` (`updated_at`);--> statement-breakpoint
CREATE TABLE `dm_reactions` (
	`dm_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`dm_id`, `user_id`, `emoji`),
	FOREIGN KEY (`dm_id`) REFERENCES `direct_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dm_reactions_dm_id` ON `dm_reactions` (`dm_id`);--> statement-breakpoint
CREATE TABLE `dm_read_states` (
	`user_id` text NOT NULL,
	`dm_channel_id` text NOT NULL,
	`last_read_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `dm_channel_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dm_channel_id`) REFERENCES `dm_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_device_keys` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`public_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`url` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text NOT NULL,
	`expires_at` text,
	`last_accessed_at` text,
	`purged_at` text,
	`lifetime_days` integer,
	`decay_cost` real,
	`blur_hash` text,
	`variants` text,
	`processing_state` text,
	CONSTRAINT "attachments_processing_state_check" CHECK("attachments"."processing_state" is null or "attachments"."processing_state" in ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_message_id` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_decay_expiry` ON `attachments` (`expires_at`) WHERE "attachments"."expires_at" is not null and "attachments"."purged_at" is null;--> statement-breakpoint
CREATE INDEX `idx_attachments_processing_pending` ON `attachments` (`processing_state`) WHERE "attachments"."processing_state" = 'pending';--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`reported_user_id` text NOT NULL,
	`reported_message_id` text,
	`server_id` text,
	`reason` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reports_reason_check" CHECK("reports"."reason" in ('spam', 'harassment', 'inappropriate_content', 'other')),
	CONSTRAINT "reports_status_check" CHECK("reports"."status" in ('pending', 'reviewed', 'resolved', 'dismissed')),
	CONSTRAINT "reports_description_length" CHECK("reports"."description" is null or length("reports"."description") <= 1000)
);
--> statement-breakpoint
CREATE INDEX `reports_server_status_idx` ON `reports` (`server_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_reporter_idx` ON `reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_reported_user_idx` ON `reports` (`reported_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
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
	CONSTRAINT "notifications_type_check" CHECK("notifications"."type" in ('mention', 'reply', 'friend_request', 'server_invite', 'system'))
);
--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`user_id`,`created_at`) WHERE "notifications"."read" = 0;--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_user_endpoint_unique` ON `push_subscriptions` (`user_id`,`endpoint`);--> statement-breakpoint
CREATE TABLE `user_notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mention_notifications` integer DEFAULT true NOT NULL,
	`reply_notifications` integer DEFAULT true NOT NULL,
	`friend_request_notifications` integer DEFAULT true NOT NULL,
	`server_invite_notifications` integer DEFAULT true NOT NULL,
	`system_notifications` integer DEFAULT true NOT NULL,
	`sound_enabled` integer DEFAULT true NOT NULL,
	`quiet_hours_enabled` integer DEFAULT false NOT NULL,
	`quiet_hours_start` text DEFAULT '22:00' NOT NULL,
	`quiet_hours_end` text DEFAULT '08:00' NOT NULL,
	`quiet_hours_timezone` text DEFAULT 'UTC' NOT NULL,
	`suppress_everyone` integer DEFAULT false NOT NULL,
	`suppress_role_mentions` integer DEFAULT false NOT NULL,
	`notification_volume` real DEFAULT 0.5 NOT NULL,
	`push_notifications` integer DEFAULT true NOT NULL,
	`show_message_preview` integer DEFAULT true NOT NULL,
	`show_unread_badge` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_notification_preferences_volume_range" CHECK("user_notification_preferences"."notification_volume" >= 0 and "user_notification_preferences"."notification_volume" <= 1)
);
--> statement-breakpoint
CREATE TABLE `badge_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'award' NOT NULL,
	`color` text DEFAULT '#00e5ff' NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`rarity` text DEFAULT 'common' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "badge_definitions_category_check" CHECK("badge_definitions"."category" in ('general', 'activity', 'moderation', 'special', 'server')),
	CONSTRAINT "badge_definitions_rarity_check" CHECK("badge_definitions"."rarity" in ('common', 'uncommon', 'rare', 'legendary'))
);
--> statement-breakpoint
CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`addressee_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addressee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friendships_no_self" CHECK("friendships"."requester_id" <> "friendships"."addressee_id"),
	CONSTRAINT "friendships_status_check" CHECK("friendships"."status" in ('pending', 'accepted', 'blocked'))
);
--> statement-breakpoint
CREATE INDEX `friendships_requester_idx` ON `friendships` (`requester_id`);--> statement-breakpoint
CREATE INDEX `friendships_addressee_idx` ON `friendships` (`addressee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_unique` ON `friendships` (`requester_id`,`addressee_id`);--> statement-breakpoint
CREATE TABLE `user_activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`ref_id` text,
	`ref_type` text,
	`ref_label` text,
	`ref_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_activity_log_event_type_check" CHECK("user_activity_log"."event_type" in ('message_posted', 'file_uploaded', 'server_joined', 'reaction_added', 'channel_created')),
	CONSTRAINT "user_activity_log_ref_type_check" CHECK("user_activity_log"."ref_type" is null or "user_activity_log"."ref_type" in ('channel', 'server', 'message', 'file')),
	CONSTRAINT "user_activity_log_summary_length" CHECK(length("user_activity_log"."summary") between 1 and 200),
	CONSTRAINT "user_activity_log_ref_label_length" CHECK("user_activity_log"."ref_label" is null or length("user_activity_log"."ref_label") <= 80),
	CONSTRAINT "user_activity_log_ref_url_length" CHECK("user_activity_log"."ref_url" is null or length("user_activity_log"."ref_url") <= 500)
);
--> statement-breakpoint
CREATE INDEX `idx_user_activity_log_user_created` ON `user_activity_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_badges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`awarded_at` text NOT NULL,
	`awarded_by` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`badge_id`) REFERENCES `badge_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`awarded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_user_badges_user_id` ON `user_badges` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_badges_badge_id` ON `user_badges` (`badge_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_badges_user_badge_unique` ON `user_badges` (`user_id`,`badge_id`);--> statement-breakpoint
CREATE TABLE `user_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`username` text,
	`display_name` text,
	`profile_url` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_connections_provider_check" CHECK("user_connections"."provider" in ('steam', 'github', 'x', 'twitch', 'youtube', 'reddit', 'website'))
);
--> statement-breakpoint
CREATE INDEX `user_connections_user_id_idx` ON `user_connections` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_connections_user_provider_unique` ON `user_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_connections_provider_user_unique` ON `user_connections` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE TABLE `user_pinned_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pin_type` text NOT NULL,
	`label` text NOT NULL,
	`sublabel` text,
	`ref_id` text,
	`url` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_pinned_items_pin_type_check" CHECK("user_pinned_items"."pin_type" in ('message', 'channel', 'file', 'link')),
	CONSTRAINT "user_pinned_items_label_length" CHECK(length("user_pinned_items"."label") between 1 and 120),
	CONSTRAINT "user_pinned_items_sublabel_length" CHECK("user_pinned_items"."sublabel" is null or length("user_pinned_items"."sublabel") <= 80),
	CONSTRAINT "user_pinned_items_url_length" CHECK("user_pinned_items"."url" is null or length("user_pinned_items"."url") <= 2000)
);
--> statement-breakpoint
CREATE INDEX `idx_user_pinned_items_user_position` ON `user_pinned_items` (`user_id`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false,
	`two_factor_enabled` integer DEFAULT false,
	`username` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`banner_color` text DEFAULT '#5865F2',
	`banner_url` text,
	`bio` text,
	`custom_tag` text,
	`status` text DEFAULT 'offline' NOT NULL,
	`status_message` text,
	`status_emoji` text,
	`status_expires_at` text,
	`discoverable` integer DEFAULT false NOT NULL,
	`appearance_settings` text DEFAULT '{}' NOT NULL,
	`interests` text DEFAULT '[]' NOT NULL,
	`activity_visibility` text DEFAULT 'public' NOT NULL,
	`onboarding_completed_at` text,
	`last_heartbeat_at` text,
	`last_online_at` text,
	`game_activity` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_appearance_settings_custom_css_length_check" CHECK(length(coalesce(json_extract("users"."appearance_settings", '$.customCss'), '')) <= 50000),
	CONSTRAINT "users_status_emoji_length_check" CHECK(length("users"."status_emoji") <= 8),
	CONSTRAINT "users_interests_max_count" CHECK(json_type("users"."interests") = 'array' and json_array_length("users"."interests") <= 15),
	CONSTRAINT "users_status_check" CHECK("users"."status" in ('online', 'idle', 'dnd', 'invisible', 'offline')),
	CONSTRAINT "users_activity_visibility_check" CHECK("users"."activity_visibility" in ('public', 'friends', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_presence_heartbeat` ON `users` (`last_heartbeat_at`) WHERE "users"."status" in ('online', 'idle', 'dnd');--> statement-breakpoint
CREATE INDEX `idx_users_last_online_at` ON `users` (`last_online_at`) WHERE "users"."last_online_at" is not null;