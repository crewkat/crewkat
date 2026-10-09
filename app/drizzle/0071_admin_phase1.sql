-- 0071: admin panel phase 1 — team roles, impersonation marker, user reports,
-- keyword auto-mod rules, promo-code log, auto-mod settings.
CREATE TABLE `admin_team_roles` (
  `user_id` integer PRIMARY KEY NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `role` text NOT NULL,
  `granted_by` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_reports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `target_type` text NOT NULL,
  `target_id` integer NOT NULL,
  `reporter_user_id` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `reason` text NOT NULL DEFAULT 'other',
  `details` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'open',
  `decided_by` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `decided_at` integer,
  `decision_note` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_reports_status_idx` ON `user_reports` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `user_reports_target_idx` ON `user_reports` (`target_type`, `target_id`);
--> statement-breakpoint
CREATE TABLE `moderation_keyword_rules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `pattern` text NOT NULL,
  `action` text NOT NULL DEFAULT 'flag',
  `note` text NOT NULL DEFAULT '',
  `created_by` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `promo_code_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `stripe_coupon_id` text NOT NULL UNIQUE,
  `code` text NOT NULL DEFAULT '',
  `percent_off` integer,
  `amount_off_cents` integer,
  `duration` text NOT NULL DEFAULT 'once',
  `created_by` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `impersonated_by` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `marketplace_messages` ADD COLUMN `hidden` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Fix pre-existing drift (2026-10-09): schema.ts declares
-- marketplace_flags.company_id but no migration created it, which breaks
-- adminModerationQueue's full-row select.
ALTER TABLE `marketplace_flags` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
INSERT INTO `platform_settings` (`key`, `value`, `updated_at`) VALUES
  ('automod_new_user_listing_cap', '3', (strftime('%s','now') * 1000)),
  ('automod_new_user_days', '7', (strftime('%s','now') * 1000)),
  ('plan_pro_name', 'Crewkat Premium', (strftime('%s','now') * 1000)),
  ('plan_pro_price_cents', '1900', (strftime('%s','now') * 1000)),
  ('plan_pro_interval', 'month', (strftime('%s','now') * 1000));
