-- Platform admin backend: admin flag on users, suspension timestamp,
-- platform settings key/value store, and an admin audit log.
ALTER TABLE `auth_users` ADD `is_platform_admin` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD `suspended_at` integer;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD `marketplace_terms_accepted_at` integer;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD `marketplace_terms_version` text;
--> statement-breakpoint
CREATE TABLE `platform_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `admin_user_id` integer NOT NULL,
  `action` text NOT NULL,
  `target_type` text NOT NULL DEFAULT '',
  `target_id` text NOT NULL DEFAULT '',
  `details` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
UPDATE `auth_users` SET `is_platform_admin` = 1 WHERE `id` = (SELECT MIN(`id`) FROM `auth_users`);
--> statement-breakpoint
INSERT INTO `platform_settings` (`key`, `value`, `updated_at`) VALUES ('auto_moderation_enabled', '1', (strftime('%s','now') * 1000)), ('flag_threshold', '3', (strftime('%s','now') * 1000));
