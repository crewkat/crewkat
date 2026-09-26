ALTER TABLE `support_reports` ADD `status` text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE `support_reports` ADD `is_unread` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `support_reports` ADD `resolved_at` integer;
--> statement-breakpoint
ALTER TABLE `support_reports` ADD `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `app_users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `role` text DEFAULT 'crew' NOT NULL,
  `is_current` integer DEFAULT 0 NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `app_users` (`name`,`role`,`is_current`,`active`,`created_at`,`updated_at`) VALUES ('Danny','owner',1,1,unixepoch()*1000,unixepoch()*1000);
--> statement-breakpoint
CREATE TABLE `admin_parameters` (
  `id` integer PRIMARY KEY NOT NULL,
  `payment_day_1` integer DEFAULT 3 NOT NULL,
  `payment_day_2` integer DEFAULT 14 NOT NULL,
  `payment_day_3` integer DEFAULT 30 NOT NULL,
  `review_delay_days` integer DEFAULT 1 NOT NULL,
  `reengagement_month_1` integer DEFAULT 6 NOT NULL,
  `reengagement_month_2` integer DEFAULT 12 NOT NULL,
  `quote_expiry_warning_days` integer DEFAULT 3 NOT NULL,
  `material_lead_time_days` integer DEFAULT 14 NOT NULL,
  `default_tax_rate` text DEFAULT '0' NOT NULL,
  `hourly_labor_cost` text DEFAULT '0' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `admin_parameters` (`id`,`updated_at`) VALUES (1,unixepoch()*1000);