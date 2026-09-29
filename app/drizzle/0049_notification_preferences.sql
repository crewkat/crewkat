-- Build 2: per-company notification preferences (marketplace messages, document signed, invoice/estimate viewed).
ALTER TABLE `settings` ADD `notify_new_message` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `notify_doc_signed` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `notify_invoice_viewed` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD `notify_estimate_viewed` integer NOT NULL DEFAULT 1;
