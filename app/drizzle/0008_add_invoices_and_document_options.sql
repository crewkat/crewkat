ALTER TABLE `quotes` ADD `subtotal` text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `discount_type` text NOT NULL DEFAULT 'percent';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `discount_value` text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `tax_type` text NOT NULL DEFAULT 'percent';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `tax_value` text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `footnote` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `font` text NOT NULL DEFAULT 'helvetica';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `accent_color` text NOT NULL DEFAULT '#1f5a4a';
--> statement-breakpoint
ALTER TABLE `settings` ADD `default_document_font` text NOT NULL DEFAULT 'helvetica';
--> statement-breakpoint
ALTER TABLE `settings` ADD `default_footnote` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE `invoices` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `quote_id` integer REFERENCES `quotes`(`id`) ON DELETE SET NULL,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE SET NULL,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL,
  `client_name` text NOT NULL,
  `client_phone` text NOT NULL DEFAULT '',
  `client_email` text NOT NULL DEFAULT '',
  `job_address` text NOT NULL DEFAULT '',
  `job_type` text NOT NULL DEFAULT '',
  `line_items_json` text NOT NULL,
  `subtotal` text NOT NULL DEFAULT '0',
  `discount_type` text NOT NULL DEFAULT 'percent',
  `discount_value` text NOT NULL DEFAULT '0',
  `tax_type` text NOT NULL DEFAULT 'percent',
  `tax_value` text NOT NULL DEFAULT '0',
  `total` text NOT NULL,
  `footnote` text NOT NULL DEFAULT '',
  `issue_date` text NOT NULL DEFAULT '',
  `due_date` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'draft',
  `theme` text NOT NULL DEFAULT 'classic',
  `font` text NOT NULL DEFAULT 'helvetica',
  `accent_color` text NOT NULL DEFAULT '#1f5a4a',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);