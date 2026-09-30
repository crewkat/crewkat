-- Platform support inbox: user support reports sent from inside the app now land
-- server-side (previously they sat in each device's local support_reports table,
-- which no one ever saw). Replies make it two-way: the platform admin can reply
-- from the admin console and the user can reply back from Settings -> Customer
-- support. There are deliberately no read receipts — only Danny's unread badge.
CREATE TABLE `platform_support_reports` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` INTEGER NOT NULL,
  `user_name` TEXT NOT NULL,
  `user_email` TEXT NOT NULL,
  `kind` TEXT NOT NULL,
  `subject` TEXT NOT NULL,
  `message` TEXT NOT NULL,
  `language` TEXT NOT NULL DEFAULT 'en',
  `status` TEXT NOT NULL DEFAULT 'open',
  `is_unread` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `resolved_at` INTEGER,
  FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platform_support_reports_user_idx` ON `platform_support_reports` (`user_id`);
--> statement-breakpoint
CREATE INDEX `platform_support_reports_created_idx` ON `platform_support_reports` (`created_at`);
--> statement-breakpoint
CREATE INDEX `platform_support_reports_status_idx` ON `platform_support_reports` (`status`);
--> statement-breakpoint
CREATE TABLE `platform_support_replies` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `report_id` INTEGER NOT NULL,
  `sender` TEXT NOT NULL,
  `message` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL,
  FOREIGN KEY (`report_id`) REFERENCES `platform_support_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platform_support_replies_report_idx` ON `platform_support_replies` (`report_id`);
--> statement-breakpoint
CREATE INDEX `platform_support_replies_created_idx` ON `platform_support_replies` (`created_at`);
