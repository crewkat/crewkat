CREATE TABLE `document_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer DEFAULT 1 NOT NULL,
	`doc_type` text NOT NULL,
	`doc_id` integer NOT NULL,
	`kind` text NOT NULL,
	`blob_key` text NOT NULL,
	`file_name` text DEFAULT '' NOT NULL,
	`content_type` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_attachments_doc_idx` ON `document_attachments` (`doc_type`,`doc_id`);--> statement-breakpoint
CREATE INDEX `document_attachments_company_idx` ON `document_attachments` (`company_id`);--> statement-breakpoint
ALTER TABLE `quotes` ADD `images_per_page` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `images_per_page` integer DEFAULT 1 NOT NULL;
