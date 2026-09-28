-- Chunk D: marketplace saved-search alerts + in-app user notifications.
CREATE TABLE `marketplace_alerts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `keyword` text NOT NULL,
  `category` text,
  `service_area` text,
  `created_at` integer NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
--> statement-breakpoint
CREATE INDEX `marketplace_alerts_user_idx` ON `marketplace_alerts` (`user_id`);
--> statement-breakpoint
CREATE TABLE `user_notifications` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL DEFAULT 'alert_match',
  `title_en` text NOT NULL DEFAULT '',
  `title_es` text NOT NULL DEFAULT '',
  `link` text NOT NULL DEFAULT '',
  `is_read` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
--> statement-breakpoint
CREATE INDEX `user_notifications_user_idx` ON `user_notifications` (`user_id`, `is_read`, `created_at`);
