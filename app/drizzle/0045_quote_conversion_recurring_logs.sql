-- Chunk C: quote->invoice conversion marker and recurring invoice schedules.
-- (Daily job log already exists as `daily_logs`; no new table needed.)
ALTER TABLE `quotes` ADD `converted_to_invoice_id` integer REFERENCES `invoices`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE `recurring_invoice_schedules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `invoice_id` integer NOT NULL REFERENCES `invoices`(`id`) ON DELETE CASCADE,
  `frequency` text NOT NULL,
  `next_run_date` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `last_generated_invoice_id` integer REFERENCES `invoices`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
--> statement-breakpoint
CREATE INDEX `recurring_invoice_schedules_due_idx` ON `recurring_invoice_schedules` (`active`, `next_run_date`);
