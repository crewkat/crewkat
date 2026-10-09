-- 0072: admin panel phase 2 — support ticket priority/assignment, internal notes,
-- policy version history, admin TOTP 2FA secrets.
ALTER TABLE `platform_support_reports` ADD COLUMN `priority` text NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE `platform_support_reports` ADD COLUMN `assigned_to` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE `platform_support_notes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `report_id` integer NOT NULL REFERENCES `platform_support_reports`(`id`) ON DELETE CASCADE,
  `author_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `note` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_support_notes_report_idx` ON `platform_support_notes` (`report_id`);
--> statement-breakpoint
CREATE TABLE `platform_policy_versions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `version` text NOT NULL,
  `url` text NOT NULL DEFAULT '',
  `effective_at` integer,
  `published_by` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_policy_versions_kind_idx` ON `platform_policy_versions` (`kind`);
--> statement-breakpoint
CREATE TABLE `admin_totp_secrets` (
  `user_id` integer PRIMARY KEY NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `secret` text NOT NULL,
  `verified` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `verified_at` integer
);
--> statement-breakpoint
-- Marks proof sessions issued pending TOTP verification (verifyTotpLogin).
ALTER TABLE `auth_sessions` ADD COLUMN `totp_pending` integer NOT NULL DEFAULT 0;
