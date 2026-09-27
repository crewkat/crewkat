-- Phase 2 invoice rebuild: auto-assigned, editable invoice numbers.
ALTER TABLE `invoices` ADD `invoice_number` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `invoices` SET `invoice_number` = 'INV-' || printf('%04d', `id`) WHERE `invoice_number` = '';
