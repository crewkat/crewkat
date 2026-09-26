ALTER TABLE `settings` ADD `hourly_cost_rate` text NOT NULL DEFAULT '0';
--> statement-breakpoint
CREATE TABLE `appointments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE SET NULL,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL,
  `client_name` text NOT NULL,
  `client_phone` text NOT NULL DEFAULT '',
  `starts_at` text NOT NULL,
  `notes` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `phone` text NOT NULL DEFAULT '',
  `source` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `stage` text NOT NULL DEFAULT 'new',
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL,
  `quote_id` integer REFERENCES `quotes`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `selections` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `category` text NOT NULL,
  `item` text NOT NULL,
  `vendor` text NOT NULL DEFAULT '',
  `photo_blob_key` text,
  `photo_filename` text NOT NULL DEFAULT '',
  `photo_content_type` text NOT NULL DEFAULT '',
  `approval_status` text NOT NULL DEFAULT 'pending',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `log_date` text NOT NULL,
  `crew` text NOT NULL DEFAULT '',
  `hours` text NOT NULL DEFAULT '0',
  `photo_ids_json` text NOT NULL DEFAULT '[]',
  `notes` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `internal_notes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE CASCADE,
  `note` text NOT NULL,
  `reminder_date` text NOT NULL DEFAULT '',
  `completed` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_milestones` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `invoice_id` integer REFERENCES `invoices`(`id`) ON DELETE SET NULL,
  `label` text NOT NULL,
  `amount` text NOT NULL DEFAULT '0',
  `percentage` text NOT NULL DEFAULT '',
  `due_date` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
