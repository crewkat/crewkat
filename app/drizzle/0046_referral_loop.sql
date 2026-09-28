-- Chunk D: referral loop — per-user referral codes, referral events, listing bonus.
ALTER TABLE `auth_users` ADD `referral_code` text;
--> statement-breakpoint
UPDATE `auth_users` SET `referral_code` = substr(upper(hex(randomblob(4))), 1, 8) WHERE `referral_code` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_referral_code_unique` ON `auth_users` (`referral_code`);
--> statement-breakpoint
CREATE TABLE `referral_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `referrer_user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `referred_user_id` integer NOT NULL UNIQUE REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `created_at` integer NOT NULL DEFAULT (strftime('%s','now') * 1000),
  `rewarded` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `referral_events_referrer_idx` ON `referral_events` (`referrer_user_id`);
--> statement-breakpoint
ALTER TABLE `settings` ADD `listing_bonus` integer NOT NULL DEFAULT 0;
