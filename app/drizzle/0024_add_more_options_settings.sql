ALTER TABLE `settings` ADD `payment_reminders_enabled` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `online_signature_enabled` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `overdue_invoice_reminders_enabled` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `overdue_reminder_days` integer NOT NULL DEFAULT 3;
--> statement-breakpoint
ALTER TABLE `settings` ADD `invoice_group_by` text NOT NULL DEFAULT 'creation_date';
--> statement-breakpoint
ALTER TABLE `settings` ADD `add_shipping_address` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD `add_job_site_address` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `convert_to_quote` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD `notifications_enabled` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `quotes` ADD `shipping_address` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `invoices` ADD `shipping_address` text NOT NULL DEFAULT '';
