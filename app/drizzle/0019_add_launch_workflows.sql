ALTER TABLE `photos` ADD `exclude_from_social` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `latitude` text;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `longitude` text;
--> statement-breakpoint
ALTER TABLE `time_entries` ADD `clock_in_latitude` text;
--> statement-breakpoint
ALTER TABLE `time_entries` ADD `clock_in_longitude` text;
--> statement-breakpoint
ALTER TABLE `time_entries` ADD `clock_out_latitude` text;
--> statement-breakpoint
ALTER TABLE `time_entries` ADD `clock_out_longitude` text;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `series_id` integer;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `parent_quote_id` integer;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `version_number` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `superseded` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `accepted` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `quotes` SET `series_id` = `id` WHERE `series_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `series_id` integer;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `parent_invoice_id` integer;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `recurring_end_date` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `invoices` ADD `recurring_cancelled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `invoices` SET `series_id` = `id` WHERE `series_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD `email` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `leads` ADD `address` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `leads` ADD `service_type` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `leads` ADD `preferred_contact_time` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `documents` ADD `client_signer_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `documents` ADD `client_signature_blob_key` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `client_signed_at` integer;
--> statement-breakpoint
CREATE TABLE `portal_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,
  `token_hash` text NOT NULL UNIQUE,
  `token_hint` text NOT NULL,
  `revoked_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_tokens_active_job_unique` ON `portal_tokens` (`job_id`) WHERE `revoked_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `time_entries_active_crew_idx` ON `time_entries` (`crew_member`,`ended_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_series_issue_unique` ON `invoices` (`series_id`,`issue_date`) WHERE `series_id` IS NOT NULL;
