ALTER TABLE `clients` ADD `referred_by_client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `recurring_frequency` text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `invoices` ADD `next_due_date` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `warranty_terms` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE `time_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `started_at` integer NOT NULL,
  `ended_at` integer,
  `note` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `receipts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `vendor` text NOT NULL DEFAULT '',
  `amount` text NOT NULL DEFAULT '0',
  `purchase_date` text NOT NULL DEFAULT '',
  `note` text NOT NULL DEFAULT '',
  `blob_key` text NOT NULL,
  `filename` text NOT NULL,
  `content_type` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crew_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `text` text NOT NULL,
  `completed` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voice_notes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `title` text NOT NULL DEFAULT '',
  `blob_key` text NOT NULL,
  `filename` text NOT NULL,
  `content_type` text NOT NULL,
  `duration_seconds` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `invoice_id` integer NOT NULL REFERENCES `invoices`(`id`) ON DELETE CASCADE,
  `amount` text NOT NULL,
  `payment_date` text NOT NULL,
  `method` text NOT NULL DEFAULT '',
  `note` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `completion_certificates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `completion_date` text NOT NULL,
  `warranty_terms` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);