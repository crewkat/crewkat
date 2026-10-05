ALTER TABLE `quotes` ADD `deposit_type` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotes` ADD `deposit_value` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `deposit_type` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `deposit_value` text DEFAULT '0' NOT NULL;