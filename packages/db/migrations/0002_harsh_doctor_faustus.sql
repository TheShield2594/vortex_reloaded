DROP INDEX `olm_one_time_keys_claim_idx`;--> statement-breakpoint
ALTER TABLE `olm_one_time_keys` ADD `consumed_at` text;--> statement-breakpoint
CREATE INDEX `olm_one_time_keys_claim_idx` ON `olm_one_time_keys` (`user_id`,`device_id`,`consumed_at`,`created_at`);