ALTER TABLE `leads` ADD COLUMN `project_size` text NOT NULL DEFAULT 'medium';
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `engagement` text NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `score` integer NOT NULL DEFAULT 50;
--> statement-breakpoint
ALTER TABLE `jobs` ADD COLUMN `required_photo_stages` text NOT NULL DEFAULT 'before,during,after';
--> statement-breakpoint
ALTER TABLE `jobs` ADD COLUMN `completed_at` integer;
--> statement-breakpoint
ALTER TABLE `jobs` ADD COLUMN `completion_override_note` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `late_fee_type` text NOT NULL DEFAULT 'percent';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `late_fee_value` text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `late_fee_grace_days` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `cost_alert_percent` integer NOT NULL DEFAULT 80;
--> statement-breakpoint
CREATE TABLE `supplier_quotes` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`supplier_id` integer NOT NULL REFERENCES `suppliers`(`id`) ON DELETE cascade,`job_id` integer REFERENCES `jobs`(`id`) ON DELETE set null,`title` text NOT NULL,`line_items_json` text NOT NULL,`total` text NOT NULL DEFAULT '0.00',`selected` integer NOT NULL DEFAULT false,`created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`supplier_id` integer NOT NULL REFERENCES `suppliers`(`id`) ON DELETE restrict,`job_id` integer REFERENCES `jobs`(`id`) ON DELETE set null,`supplier_quote_id` integer REFERENCES `supplier_quotes`(`id`) ON DELETE set null,`number` text NOT NULL,`status` text NOT NULL DEFAULT 'draft',`line_items_json` text NOT NULL,`total` text NOT NULL DEFAULT '0.00',`created_at` integer NOT NULL,`updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `equipment` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`name` text NOT NULL,`category` text NOT NULL DEFAULT '',`purchase_date` text NOT NULL DEFAULT '',`cost` text NOT NULL DEFAULT '0.00',`serial_number` text NOT NULL DEFAULT '',`assigned_to` text NOT NULL DEFAULT 'shop',`photo_blob_key` text,`maintenance_task` text NOT NULL DEFAULT '',`maintenance_every_days` integer NOT NULL DEFAULT 90,`next_maintenance_date` text NOT NULL DEFAULT '',`checked_out_at` integer,`returned_at` integer,`created_at` integer NOT NULL,`updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `safety_talks` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,`topic_key` text NOT NULL,`talk_date` text NOT NULL,`checklist_json` text NOT NULL DEFAULT '[]',`acknowledgements_json` text NOT NULL DEFAULT '[]',`created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `incidents` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,`incident_date` text NOT NULL,`description` text NOT NULL,`severity` text NOT NULL,`corrective_action` text NOT NULL DEFAULT '',`photo_blob_key` text,`created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `credentials` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`owner_type` text NOT NULL,`subcontractor_id` integer REFERENCES `subcontractors`(`id`) ON DELETE cascade,`kind` text NOT NULL,`identifier` text NOT NULL DEFAULT '',`expires_on` text NOT NULL,`renewed_at` integer,`created_at` integer NOT NULL,`updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `crew_pay_rates` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`crew_member` text NOT NULL UNIQUE,`hourly_rate` text NOT NULL DEFAULT '0.00',`updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `completion_overrides` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE cascade,`missing_stages` text NOT NULL,`note` text NOT NULL,`created_at` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `credentials` (`owner_type`,`subcontractor_id`,`kind`,`identifier`,`expires_on`,`created_at`,`updated_at`) VALUES ('business',NULL,'Florida contractor license','CRC1335847','2028-08-31',unixepoch()*1000,unixepoch()*1000);