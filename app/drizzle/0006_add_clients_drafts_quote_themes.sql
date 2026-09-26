CREATE TABLE `clients` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `phone` text NOT NULL DEFAULT '',
  `email` text NOT NULL DEFAULT '',
  `address` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `client_id` integer REFERENCES `clients`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `client_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `client_id` integer REFERENCES `clients`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `client_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `theme` text NOT NULL DEFAULT 'classic';
--> statement-breakpoint
ALTER TABLE `progress_updates` ADD `status` text NOT NULL DEFAULT 'sent';
--> statement-breakpoint
ALTER TABLE `progress_updates` ADD `updated_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD `accent_color` text NOT NULL DEFAULT '#1f5a4a';
--> statement-breakpoint
ALTER TABLE `settings` ADD `default_quote_theme` text NOT NULL DEFAULT 'classic';
--> statement-breakpoint
ALTER TABLE `settings` ADD `logo_blob_key` text;
