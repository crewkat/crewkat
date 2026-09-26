ALTER TABLE `jobs` ADD `client_phone` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `appointment_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `due_date` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `deposit_amount` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `gallery_pick` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `photos` ADD `gallery_pick` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `photos` ADD `annotated_from_id` integer;
--> statement-breakpoint
ALTER TABLE `settings` ADD `payment_instructions` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `quote_follow_up_days` integer NOT NULL DEFAULT 3;
--> statement-breakpoint
CREATE TABLE `documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `body_text` text NOT NULL DEFAULT '',
  `original_blob_key` text,
  `original_filename` text NOT NULL DEFAULT '',
  `description` text NOT NULL DEFAULT '',
  `amount` text NOT NULL DEFAULT '',
  `signer_name` text NOT NULL,
  `signature_blob_key` text NOT NULL,
  `signed_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quotes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_name` text NOT NULL,
  `client_phone` text NOT NULL DEFAULT '',
  `job_address` text NOT NULL DEFAULT '',
  `job_type` text NOT NULL DEFAULT '',
  `line_items_json` text NOT NULL,
  `total` text NOT NULL,
  `expiry_date` text NOT NULL DEFAULT '',
  `sent_at` text NOT NULL DEFAULT '',
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE set null,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `punch_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `text` text NOT NULL,
  `completed` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `punch_signoffs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `customer_name` text NOT NULL,
  `customer_signature_blob_key` text NOT NULL,
  `contractor_name` text NOT NULL,
  `contractor_signature_blob_key` text NOT NULL,
  `signed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `progress_updates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `day_number` integer NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `photo_ids_json` text NOT NULL DEFAULT '[]',
  `created_at` integer NOT NULL
);
