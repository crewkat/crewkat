CREATE TABLE `broadcast_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `segment` text NOT NULL,
  `sent_count` integer NOT NULL DEFAULT 0,
  `created_by` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `broadcast_log_created_idx` ON `broadcast_log` (`created_at`);
--> statement-breakpoint
CREATE TABLE `business_verifications` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL UNIQUE,
  `license_number` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'pending',
  `note` text NOT NULL DEFAULT '',
  `reviewed_by` integer,
  `reviewed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
  `key` text PRIMARY KEY NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `description` text NOT NULL DEFAULT '',
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `feature_flags` (`key`, `enabled`, `description`, `updated_at`) VALUES
  ('marketplace_enabled', COALESCE((SELECT CASE `value` WHEN '1' THEN 1 ELSE 0 END FROM `platform_settings` WHERE `key` = 'marketplace_enabled'), 1), 'Marketplace listings, search, and messaging', (strftime('%s','now') * 1000)),
  ('signups_enabled', COALESCE((SELECT CASE `value` WHEN '1' THEN 1 ELSE 0 END FROM `platform_settings` WHERE `key` = 'registration_enabled'), 1), 'New account registrations', (strftime('%s','now') * 1000)),
  ('broadcasts_enabled', 1, 'Admin broadcast push messages', (strftime('%s','now') * 1000));
--> statement-breakpoint
CREATE TABLE `send_caps` (
  `user_id` integer PRIMARY KEY NOT NULL,
  `max_sms_per_day` integer NOT NULL,
  `max_push_per_day` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocked_senders` (
  `user_id` integer PRIMARY KEY NOT NULL,
  `reason` text NOT NULL DEFAULT '',
  `blocked_by` integer,
  `blocked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `send_usage` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `channel` text NOT NULL,
  `period` text NOT NULL,
  `period_start` integer NOT NULL,
  `count` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_usage_user_channel_period_start_unique` ON `send_usage` (`user_id`, `channel`, `period`, `period_start`);
--> statement-breakpoint
CREATE INDEX `send_usage_user_idx` ON `send_usage` (`user_id`, `channel`);
--> statement-breakpoint
INSERT INTO `platform_settings` (`key`, `value`, `updated_at`) VALUES
  ('default_max_sms_per_day', '50', (strftime('%s','now') * 1000)),
  ('default_max_push_per_day', '100', (strftime('%s','now') * 1000));
