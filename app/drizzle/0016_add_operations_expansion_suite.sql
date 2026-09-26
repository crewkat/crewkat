ALTER TABLE `quotes` ADD `lost_reason` text;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `lost_note` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `time_entries` ADD `crew_member` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `business_expenses` ADD `supplier_id` integer;
--> statement-breakpoint
ALTER TABLE `receipts` ADD `supplier_id` integer;
--> statement-breakpoint
CREATE TABLE `warranties` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE set null,
  `terms` text NOT NULL DEFAULT '',
  `start_date` text NOT NULL,
  `duration_months` integer NOT NULL DEFAULT 12,
  `expiry_date` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slideshow_videos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `caption` text NOT NULL DEFAULT '',
  `branded` integer NOT NULL DEFAULT 1,
  `blob_key` text NOT NULL,
  `filename` text NOT NULL,
  `content_type` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scanned_documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE cascade,
  `expense_id` integer REFERENCES `business_expenses`(`id`) ON DELETE set null,
  `title` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'receipt',
  `blob_key` text NOT NULL,
  `filename` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL DEFAULT '',
  `phone` text NOT NULL DEFAULT '',
  `email` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_plans` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE set null,
  `client_name` text NOT NULL,
  `client_phone` text NOT NULL DEFAULT '',
  `title` text NOT NULL,
  `tasks` text NOT NULL DEFAULT '',
  `start_date` text NOT NULL,
  `interval_months` integer NOT NULL DEFAULT 12,
  `next_due_date` text NOT NULL,
  `last_job_id` integer REFERENCES `jobs`(`id`) ON DELETE set null,
  `active` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);